"""Pydantic models for API responses."""

from pydantic import BaseModel


class PoiOut(BaseModel):
    # "osm_type:osm_id" - what /api/export's excluded_poi_ids expects back.
    id: str
    osm_id: int
    osm_type: str
    lat: float
    lon: float
    category_id: str
    name: str | None
    distance_to_route_m: float
    # Where to leave the route for this POI, and the path there (this POI
    # last). A straight line unless is_routed says a real bike route was
    # found for it instead - see turnoff.py.
    meeting_point: tuple[float, float]
    connector_path: list[tuple[float, float]]
    is_routed: bool


class AnalyzeResponse(BaseModel):
    pois: list[PoiOut]
    attribution: str = "© OpenStreetMap contributors"
