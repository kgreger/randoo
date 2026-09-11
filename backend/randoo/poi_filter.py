"""Filter raw Overpass results down to what's actually inside the route buffer,
and rank them by distance to the route."""

from dataclasses import dataclass

from shapely.geometry import MultiLineString, Point as ShapelyPoint
from shapely.geometry.base import BaseGeometry
from shapely.ops import transform

from .geometry import local_crs_transformer
from .gpx import Point
from .overpass import Poi


@dataclass(frozen=True)
class RankedPoi:
    poi: Poi
    distance_to_route_m: float


def filter_and_rank(
    pois: list[Poi], segments: list[list[Point]], buffer_geometry: BaseGeometry
) -> list[RankedPoi]:
    """Keep only POIs inside the buffer, sorted nearest-to-route first.

    Distance is measured against the route as recorded: each segment on its
    own, never bridged to the next one by a straight line across whatever
    gap separates them.
    """
    all_points = [p for segment in segments for p in segment]
    to_local, _ = local_crs_transformer(all_points)

    local_lines = [
        [to_local.transform(p.lon, p.lat) for p in segment]
        for segment in segments
        if len(segment) > 1
    ]
    route = MultiLineString(local_lines)
    local_geometry = transform(lambda x, y: to_local.transform(x, y), buffer_geometry)

    ranked = []
    for poi in pois:
        x, y = to_local.transform(poi.lon, poi.lat)
        point = ShapelyPoint(x, y)
        if not local_geometry.contains(point):
            continue
        ranked.append(RankedPoi(poi=poi, distance_to_route_m=point.distance(route)))

    ranked.sort(key=lambda r: r.distance_to_route_m)
    return ranked
