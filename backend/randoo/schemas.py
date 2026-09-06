"""Pydantic models for API responses."""

from pydantic import BaseModel


class PoiOut(BaseModel):
    osm_id: int
    osm_type: str
    lat: float
    lon: float
    category_id: str
    name: str | None
    distance_to_route_m: float


class AnalyzeResponse(BaseModel):
    pois: list[PoiOut]
    attribution: str = "© OpenStreetMap contributors"
