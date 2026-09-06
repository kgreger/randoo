"""Filter raw Overpass results down to what's actually inside the route buffer,
and rank them by distance to the route."""

from dataclasses import dataclass

from shapely.geometry import LineString, Point as ShapelyPoint, Polygon

from .geometry import local_crs_transformer
from .gpx import Point
from .overpass import Poi


@dataclass(frozen=True)
class RankedPoi:
    poi: Poi
    distance_to_route_m: float


def filter_and_rank(
    pois: list[Poi], route_points: list[Point], buffer_polygon: Polygon
) -> list[RankedPoi]:
    """Keep only POIs inside the buffer polygon, sorted nearest-to-route first."""
    to_local, _ = local_crs_transformer(route_points)

    local_line = LineString([to_local.transform(p.lon, p.lat) for p in route_points])
    local_polygon = Polygon(
        [to_local.transform(x, y) for x, y in buffer_polygon.exterior.coords]
    )

    ranked = []
    for poi in pois:
        x, y = to_local.transform(poi.lon, poi.lat)
        point = ShapelyPoint(x, y)
        if not local_polygon.contains(point):
            continue
        ranked.append(RankedPoi(poi=poi, distance_to_route_m=point.distance(local_line)))

    ranked.sort(key=lambda r: r.distance_to_route_m)
    return ranked
