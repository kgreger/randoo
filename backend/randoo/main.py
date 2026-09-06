from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

from . import categories, geometry, gpx, overpass, poi_filter
from .export import build_gpx
from .schemas import AnalyzeResponse, PoiOut

app = FastAPI(title="Randoo API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


async def _find_pois(
    file: UploadFile, category_ids: list[str], radius_m: float
) -> tuple[list[poi_filter.RankedPoi], list[gpx.Point]]:
    if radius_m <= 0 or radius_m > 5000:
        raise HTTPException(400, "radius_m must be between 0 and 5000")

    try:
        selected = categories.resolve(category_ids)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

    raw = await file.read()
    try:
        points = gpx.parse_track(raw)
    except gpx.InvalidGpxError as exc:
        raise HTTPException(400, str(exc)) from exc

    buffer_polygon = geometry.route_buffer(points, radius_m)
    bbox = geometry.bounding_box(buffer_polygon)

    pois = await overpass.query_pois(bbox, selected)
    ranked = poi_filter.filter_and_rank(pois, points, buffer_polygon)
    return ranked, points


@app.post("/api/analyze", response_model=AnalyzeResponse)
async def analyze(
    file: UploadFile = File(...),
    categories_param: list[str] = Form(..., alias="categories"),
    radius_m: float = Form(500),
) -> AnalyzeResponse:
    ranked, _ = await _find_pois(file, categories_param, radius_m)
    return AnalyzeResponse(
        pois=[
            PoiOut(
                osm_id=r.poi.osm_id,
                osm_type=r.poi.osm_type,
                lat=r.poi.lat,
                lon=r.poi.lon,
                category_id=r.poi.category_id,
                name=r.poi.name,
                distance_to_route_m=round(r.distance_to_route_m, 1),
            )
            for r in ranked
        ]
    )


@app.post("/api/export")
async def export(
    file: UploadFile = File(...),
    categories_param: list[str] = Form(..., alias="categories"),
    radius_m: float = Form(500),
) -> Response:
    ranked, _ = await _find_pois(file, categories_param, radius_m)
    xml = build_gpx(ranked)
    return Response(
        content=xml,
        media_type="application/gpx+xml",
        headers={"Content-Disposition": 'attachment; filename="randoo-pois.gpx"'},
    )
