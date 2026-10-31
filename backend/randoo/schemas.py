"""Pydantic models for API responses."""

from pydantic import BaseModel, Field


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
    # Where this POI's nearest point falls along the route, cumulative
    # across all segments in recording order - what the list is sorted by,
    # exposed so the frontend can show it as a route km rather than making
    # the rider work that out from the map.
    distance_along_route_m: float
    # Where to leave the route for this POI, and the path there (this POI
    # last). A straight line unless is_routed says a real bike route was
    # found for it instead - see turnoff.py.
    meeting_point: tuple[float, float]
    connector_path: list[tuple[float, float]]
    is_routed: bool


class AnalyzeResponse(BaseModel):
    pois: list[PoiOut]
    # What /api/route-connectors takes to refine this search's connectors,
    # and whether the caller may: every connector here is still a straight
    # line, routing comes afterwards in batches.
    search_id: str
    routing: bool
    attribution: str = "© OpenStreetMap contributors"


class RouteRequest(BaseModel):
    search_id: str = Field(max_length=64)
    poi_ids: list[str]


class RoutedConnector(BaseModel):
    id: str
    meeting_point: tuple[float, float]
    connector_path: list[tuple[float, float]]
    is_routed: bool


class RouteResponse(BaseModel):
    pois: list[RoutedConnector]


class ExportPoi(BaseModel):
    """The part of a PoiOut that /api/export needs to write a waypoint, sent
    back by the frontend so an export reproduces exactly what the rider saw
    (including a saved plan's points) instead of searching again."""

    id: str
    osm_id: int
    osm_type: str = Field(max_length=16)
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    category_id: str = Field(max_length=40)
    name: str | None = Field(default=None, max_length=200)
    distance_to_route_m: float
    meeting_point: tuple[float, float]
