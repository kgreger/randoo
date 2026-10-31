import asyncio
import dataclasses
import json
from importlib.metadata import version as package_version
from contextlib import asynccontextmanager

import duckdb
from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import TypeAdapter, ValidationError

from . import categories, geometry, gpx, poi_filter, search_cache
from .auth import bearer_token, require_user
from .entitlements import get_tier
from .export import (
    DEVICE_MAKES,
    WAYPOINT_TYPES,
    apply_waypoint_types,
    build_gpx,
    course_point_count,
    device_profile,
    segments_for_device,
)
from .overpass import Poi
from .poi_filter import Connector, RankedPoi
from .poi_source import OverpassPoiSource, get_poi_source
from .schemas import AnalyzeResponse, ExportPoi, PoiOut, RoutedConnector, RouteRequest, RouteResponse
from .split import part_count, split_gpx
from .turnoff import get_turnoff_locator, routing_available

@asynccontextmanager
async def lifespan(_app: FastAPI):
    sweep = asyncio.create_task(search_cache.prune_periodically())
    yield
    sweep.cancel()


app = FastAPI(title="Randoo API", lifespan=lifespan)

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
    return {"status": "ok", "version": package_version("randoo")}


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


# Neither end may take more than this share of the route, so there is
# always a stretch left to search along.
MAX_SKIP_PCT = 40


async def _find_pois(
    file: UploadFile,
    category_ids: list[str],
    radius_m: float,
    tier: str,
    skip_start_pct: float = 0,
    skip_end_pct: float = 0,
) -> tuple[list[poi_filter.RankedPoi], list[list[gpx.Point]], str]:
    if radius_m <= 0 or radius_m > 5000:
        raise HTTPException(400, "radius_m must be between 0 and 5000")
    if not (0 <= skip_start_pct <= MAX_SKIP_PCT and 0 <= skip_end_pct <= MAX_SKIP_PCT):
        raise HTTPException(400, f"skip_start_pct and skip_end_pct must be between 0 and {MAX_SKIP_PCT}")

    try:
        selected = categories.resolve(category_ids)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

    raw = await file.read()

    # Export re-sends the same file and parameters analyze just used, so it
    # lands on the same key here automatically - this is what skips redoing
    # the whole search a second time. The key doubles as the search id
    # /api/route-connectors refines the connectors under.
    cache_key = search_cache.make_key(raw, category_ids, radius_m, tier, skip_start_pct, skip_end_pct)
    cached = search_cache.get(cache_key)
    if cached is not None:
        return *cached, cache_key

    try:
        segments = gpx.parse_track(raw)
    except gpx.InvalidGpxError as exc:
        raise HTTPException(400, str(exc)) from exc

    # Only the part between the skipped start and end is asked for, but
    # ranking still goes against the whole route, so a point's route km
    # stays the one the rider sees on their device. The search radius
    # reaches past either cut, so a point found there is dropped by its
    # route km.
    search_segments = segments
    if skip_start_pct or skip_end_pct:
        length_m = geometry.route_length_m(segments)
        keep_from_m = length_m * skip_start_pct / 100
        keep_to_m = length_m * (1 - skip_end_pct / 100)
        search_segments = geometry.trim_route(segments, keep_from_m, length_m - keep_to_m)
    pois = await _query_pois(tier, search_segments, radius_m, selected)
    ranked = poi_filter.filter_and_rank(pois, segments, radius_m)
    if skip_start_pct or skip_end_pct:
        ranked = [r for r in ranked if keep_from_m <= r.distance_along_route_m <= keep_to_m]

    search_cache.set(cache_key, ranked, segments)
    return ranked, segments, cache_key


@app.post("/api/analyze", response_model=AnalyzeResponse)
async def analyze(
    file: UploadFile = File(...),
    categories_param: list[str] = Form(..., alias="categories"),
    radius_m: float = Form(500),
    skip_start_pct: float = Form(0),
    skip_end_pct: float = Form(0),
    token: str | None = Depends(bearer_token),
) -> AnalyzeResponse:
    # Search stays fully anonymous-friendly - a signed-in premium caller just
    # gets the faster local path too, on top of what free already gets.
    tier = await get_tier(token)
    ranked, _, search_id = await _find_pois(
        file, categories_param, radius_m, tier, skip_start_pct, skip_end_pct
    )
    return AnalyzeResponse(
        search_id=search_id,
        routing=routing_available(tier),
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


# Routing every POI of a long route in one request could outlast the
# reverse proxy's timeout, so /api/analyze answers with straight connectors
# and the frontend asks for the routed ones in batches of at most this many.
MAX_ROUTE_BATCH = 50


@app.post("/api/route-connectors", response_model=RouteResponse)
async def route_connectors(request: RouteRequest, token: str | None = Depends(bearer_token)) -> RouteResponse:
    if len(request.poi_ids) > MAX_ROUTE_BATCH:
        raise HTTPException(400, f"at most {MAX_ROUTE_BATCH} points can be routed at once")
    tier = await get_tier(token)
    if not routing_available(tier):
        raise HTTPException(403, "routing is not available")
    cached = search_cache.get(request.search_id)
    if cached is None:
        raise HTTPException(404, "search expired")
    ranked, segments = cached

    wanted = set(request.poi_ids)
    indices = [i for i, r in enumerate(ranked) if _poi_id(r.poi) in wanted and not r.is_routed]
    locator = get_turnoff_locator(tier)
    connectors = await asyncio.gather(
        *(locator.refine(ranked[i].poi, segments, ranked[i].connector) for i in indices)
    )
    # Written back into the cached search, so a batch asked for twice (or an
    # export served from the cache) gets the routed connector without
    # routing it again. Storing it again also restarts the entry's TTL,
    # which keeps a long route's search alive while its batches come in.
    for i, connector in zip(indices, connectors):
        is_routed = connector is not ranked[i].connector
        ranked[i] = dataclasses.replace(ranked[i], connector=connector, is_routed=is_routed)
    search_cache.set(request.search_id, ranked, segments)

    return RouteResponse(
        pois=[
            RoutedConnector(
                id=_poi_id(r.poi),
                meeting_point=(r.connector.meeting_point.lat, r.connector.meeting_point.lon),
                connector_path=[(p.lat, p.lon) for p in r.connector.path],
                is_routed=r.is_routed,
            )
            for r in ranked
            if _poi_id(r.poi) in wanted
        ]
    )


MAX_EXPORT_POIS = 5000

_export_pois = TypeAdapter(list[ExportPoi])


def _ranked_from_export(raw: str) -> list[RankedPoi]:
    try:
        pois = _export_pois.validate_python(json.loads(raw))
    except (ValueError, ValidationError) as exc:
        raise HTTPException(400, "pois is not a valid list of points") from exc
    if len(pois) > MAX_EXPORT_POIS:
        raise HTTPException(400, f"at most {MAX_EXPORT_POIS} points can be exported")
    return [
        RankedPoi(
            poi=Poi(
                osm_id=p.osm_id,
                osm_type=p.osm_type,
                lat=p.lat,
                lon=p.lon,
                category_id=p.category_id,
                name=p.name,
                tags={},
            ),
            distance_to_route_m=p.distance_to_route_m,
            distance_along_route_m=0.0,
            connector=Connector(meeting_point=gpx.Point(*p.meeting_point), path=[]),
        )
        for p in pois
    ]


def _parse_type_overrides(raw: str | None) -> dict[str, str]:
    if raw is None:
        return {}
    try:
        value = json.loads(raw)
    except ValueError as exc:
        raise HTTPException(400, "type_overrides is not valid JSON") from exc
    if not isinstance(value, dict):
        raise HTTPException(400, "type_overrides must be an object")
    return {k: v for k, v in value.items() if isinstance(k, str) and isinstance(v, str) and v in WAYPOINT_TYPES}


@app.post("/api/export")
async def export(
    file: UploadFile = File(...),
    categories_param: list[str] = Form(default=[], alias="categories"),
    radius_m: float = Form(500),
    skip_start_pct: float = Form(0),
    skip_end_pct: float = Form(0),
    pois: str | None = Form(default=None),
    type_overrides: str | None = Form(default=None),
    device_make: str | None = Form(default=None),
    device_model: str | None = Form(default=None),
    excluded_poi_ids: list[str] = Form(default=[]),
    ignore_point_limit: bool = Form(default=False),
    split: bool = Form(default=False),
    course_name: str = Form(default=""),
    _user: dict = Depends(require_user),
    token: str | None = Depends(bearer_token),
) -> Response:
    raw = await file.read()
    await file.seek(0)
    existing_waypoints, existing_nsmap = gpx.parse_existing_waypoints(raw)
    # The file's own waypoints keep the ids the frontend shows them under
    # ("wpt:<n>"), so the rider's choices on them (unticked, re-typed) apply here.
    excluded = set(excluded_poi_ids)
    profile = device_profile(device_make if device_make in DEVICE_MAKES else None, device_model)
    apply_waypoint_types(existing_waypoints, _parse_type_overrides(type_overrides), profile)
    existing_waypoints = [wp for i, wp in enumerate(existing_waypoints) if f"wpt:{i}" not in excluded]

    if pois is not None:
        # The points the rider is looking at come with the request, so a
        # saved plan exports as saved and nothing is searched again.
        try:
            segments = gpx.parse_track(raw)
        except gpx.InvalidGpxError as exc:
            raise HTTPException(400, str(exc)) from exc
        ranked = _ranked_from_export(pois)
    else:
        if not categories_param:
            raise HTTPException(400, "categories or pois is required")
        tier = await get_tier(token)
        ranked, segments, _ = await _find_pois(
            file, categories_param, radius_m, tier, skip_start_pct, skip_end_pct
        )

    # A POI passing the search doesn't mean the rider actually wants it in
    # the file - excluded_poi_ids is how the frontend's per-POI selection
    # gets applied, using the same "osm_type:osm_id" ids /api/analyze returns.
    ranked = [r for r in ranked if _poi_id(r.poi) not in excluded]

    device_segments = segments_for_device(segments, profile)
    limit = profile.max_course_points
    if limit is not None and split:
        parts = split_gpx(
            ranked, device_segments[0], existing_waypoints, existing_nsmap, profile, course_name, limit
        )
        return JSONResponse(
            {"parts": [{"name": p.name, "filename": p.filename, "gpx": p.gpx} for p in parts]}
        )
    if limit is not None and not ignore_point_limit:
        course_points = course_point_count(ranked, existing_waypoints, profile)
        if course_points > limit:
            return JSONResponse(
                status_code=409,
                content={
                    "code": "too_many_course_points",
                    "course_points": course_points,
                    "limit": limit,
                    "parts": part_count(course_points, limit),
                },
            )

    xml = build_gpx(ranked, device_segments, existing_waypoints, existing_nsmap, profile)
    return Response(
        content=xml,
        media_type="application/gpx+xml",
        headers={"Content-Disposition": 'attachment; filename="randoo-pois.gpx"'},
    )
