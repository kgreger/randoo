"""Filter raw Overpass results down to what's actually inside the route buffer,
and rank them by where they fall along the route."""

from dataclasses import dataclass

from shapely.geometry import LineString, Point as ShapelyPoint
from shapely.geometry.base import BaseGeometry
from shapely.ops import transform

from .geometry import local_crs_transformer
from .gpx import Point
from .overpass import Poi


@dataclass(frozen=True)
class Connector:
    """How to get from the route to a POI: where you'd turn off, and the
    path from there to the POI itself, POI as the last point.

    The geometric version (what filter_and_rank always fills in) is just a
    straight line, meeting_point to the POI. A routed one (see turnoff.py)
    replaces both with the real path a routing engine found - same shape
    either way, so nothing downstream needs to know which kind it got.
    """

    meeting_point: Point
    path: list[Point]


@dataclass(frozen=True)
class RankedPoi:
    poi: Poi
    distance_to_route_m: float
    # How far along the route (cumulative, across all segments in recording
    # order) this POI's nearest point falls - what the list is actually
    # sorted by, so it reads in the order a rider passes things, not by
    # who happens to be closest to the line.
    distance_along_route_m: float
    connector: Connector


def filter_and_rank(
    pois: list[Poi], segments: list[list[Point]], buffer_geometry: BaseGeometry
) -> list[RankedPoi]:
    """Keep only POIs inside the buffer, sorted by where they fall along the
    route rather than by distance to it - the order a rider actually
    encounters them, not a jumble of whoever's nearest from anywhere on a
    long route. distance_to_route_m stays available on each result; it just
    isn't what orders the list anymore.

    Distance (both to and along the route) is measured against the route as
    recorded: each segment on its own, never bridged to the next one by a
    straight line across whatever gap separates them.
    """
    all_points = [p for segment in segments for p in segment]
    to_local, to_wgs84 = local_crs_transformer(all_points)

    lines = [
        LineString([to_local.transform(p.lon, p.lat) for p in segment])
        for segment in segments
        if len(segment) > 1
    ]
    # Cumulative route length before each segment, so "distance along route"
    # spans the whole multi-segment route in recording order rather than
    # just position within whichever segment a POI happens to be nearest to.
    offsets = []
    cumulative = 0.0
    for line in lines:
        offsets.append(cumulative)
        cumulative += line.length

    local_geometry = transform(lambda x, y: to_local.transform(x, y), buffer_geometry)

    ranked = []
    for poi in pois:
        x, y = to_local.transform(poi.lon, poi.lat)
        point = ShapelyPoint(x, y)
        if not local_geometry.contains(point):
            continue

        distances = [line.distance(point) for line in lines]
        nearest_idx = min(range(len(lines)), key=distances.__getitem__)
        nearest_line = lines[nearest_idx]
        progress = nearest_line.project(point)
        on_route = nearest_line.interpolate(progress)
        route_lon, route_lat = to_wgs84.transform(on_route.x, on_route.y)
        meeting_point = Point(route_lat, route_lon)

        ranked.append(
            RankedPoi(
                poi=poi,
                distance_to_route_m=distances[nearest_idx],
                distance_along_route_m=offsets[nearest_idx] + progress,
                connector=Connector(meeting_point=meeting_point, path=[meeting_point, Point(poi.lat, poi.lon)]),
            )
        )

    ranked.sort(key=lambda r: r.distance_along_route_m)
    return ranked
