import asyncio
import dataclasses

import duckdb
from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

from . import categories, geometry, gpx, poi_filter, search_cache
from .auth import bearer_token, require_user
from .entitlements import get_tier
from .export import build_gpx
from .overpass import Poi
from .poi_source import OverpassPoiSource, get_poi_source
from .schemas import AnalyzeResponse, PoiOut
from .turnoff import get_turnoff_locator

app = FastAPI(title="Randoo API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _poi_id(poi) -> str:
    """A stable identifier for one POI within a search's results - `osm_id`
    alone isn't safe to use across types, since a node and a way can share
    the same numeric id."""
    return f"{poi.osm_type}:{poi.osm_id}"


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


async def _query_pois(
    tier: str, segments: list[list[gpx.Point]], radius_m: float, selected: list[categories.Category]
) -> list[Poi]:
    try:
        return await get_poi_source(tier).query(segments, radius_m, selected)
    except duckdb.Error:
        # Only LocalPoiSource ever touches DuckDB, so this can only mean the
        # local index itself is the problem (a bad path, a missing mount,
        # ...), not that Overpass is failing too. Same principle as
        # entitlements.get_tier's own fallback: a broken local index should
        # never be the reason a premium search fails outright, only the
        # reason it's slower.
        return await OverpassPoiSource().query(segments, radius_m, selected)


async def _find_pois(
    file: UploadFile, category_ids: list[str], radius_m: float, tier: str
) -> tuple[list[poi_filter.RankedPoi], list[list[gpx.Point]]]:
    if radius_m <= 0 or radius_m > 5000:
        raise HTTPException(400, "radius_m must be between 0 and 5000")

    try:
        selected = categories.resolve(category_ids)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

    raw = await file.read()

    # Export re-sends the same file and parameters analyze just used, so it
    # lands on the same key here automatically - this is what skips redoing
    # the whole search (POI source query, any per-POI routing) a second time.
    cache_key = search_cache.make_key(raw, category_ids, radius_m, tier)
    cached = search_cache.get(cache_key)
    if cached is not None:
        return cached

    try:
        segments = gpx.parse_track(raw)
    except gpx.InvalidGpxError as exc:
        raise HTTPException(400, str(exc)) from exc

    buffer_geometry = geometry.route_buffer(segments, radius_m)
    pois = await _query_pois(tier, segments, radius_m, selected)
    ranked = poi_filter.filter_and_rank(pois, segments, buffer_geometry)
    ranked = await _refine_connectors(ranked, segments, tier)

    search_cache.set(cache_key, ranked, segments)
    return ranked, segments


async def _refine_connectors(
    ranked: list[poi_filter.RankedPoi], segments: list[list[gpx.Point]], tier: str
) -> list[poi_filter.RankedPoi]:
    """Replaces each POI's straight-line connector with a routed one where
    the caller's tier allows it - done here, before the result is cached,
    so a routing call (BRouter has no bulk endpoint, this is one request per
    POI) only ever happens once per search, not again on every export of it.

    Every POI's own refine() call runs concurrently (gather preserves the
    input order, so zipping back against `ranked` still lines up) - run one
    at a time, a POI-heavy search could take minutes even with a fast
    self-hosted BRouter behind it, purely from waiting on each in turn.
    """
    locator = get_turnoff_locator(tier)
    connectors = await asyncio.gather(*(locator.refine(r.poi, segments, r.connector) for r in ranked))
    return [
        dataclasses.replace(r, connector=connector, is_routed=connector is not r.connector)
        for r, connector in zip(ranked, connectors)
    ]


@app.post("/api/analyze", response_model=AnalyzeResponse)
async def analyze(
    file: UploadFile = File(...),
    categories_param: list[str] = Form(..., alias="categories"),
    radius_m: float = Form(500),
    token: str | None = Depends(bearer_token),
) -> AnalyzeResponse:
    # Search stays fully anonymous-friendly - a signed-in premium caller just
    # gets the faster local path too, on top of what free already gets.
    tier = await get_tier(token)
    ranked, _ = await _find_pois(file, categories_param, radius_m, tier)
    return AnalyzeResponse(
        pois=[
            PoiOut(
                id=_poi_id(r.poi),
                osm_id=r.poi.osm_id,
                osm_type=r.poi.osm_type,
                lat=r.poi.lat,
                lon=r.poi.lon,
                category_id=r.poi.category_id,
                name=r.poi.name,
                distance_to_route_m=round(r.distance_to_route_m, 1),
                distance_along_route_m=round(r.distance_along_route_m, 1),
                meeting_point=(r.connector.meeting_point.lat, r.connector.meeting_point.lon),
                connector_path=[(p.lat, p.lon) for p in r.connector.path],
                is_routed=r.is_routed,
            )
            for r in ranked
        ]
    )


@app.post("/api/export")
async def export(
    file: UploadFile = File(...),
    categories_param: list[str] = Form(..., alias="categories"),
    radius_m: float = Form(500),
    excluded_poi_ids: list[str] = Form(default=[]),
    _user: dict = Depends(require_user),
    token: str | None = Depends(bearer_token),
) -> Response:
    tier = await get_tier(token)
    ranked, segments = await _find_pois(file, categories_param, radius_m, tier)

    # A POI passing the search doesn't mean the rider actually wants it in
    # the file - excluded_poi_ids is how the frontend's per-POI selection
    # gets applied, using the same "osm_type:osm_id" ids /api/analyze returns.
    excluded = set(excluded_poi_ids)
    ranked = [r for r in ranked if _poi_id(r.poi) not in excluded]

    xml = build_gpx(ranked, segments)
    return Response(
        content=xml,
        media_type="application/gpx+xml",
        headers={"Content-Disposition": 'attachment; filename="randoo-pois.gpx"'},
    )
