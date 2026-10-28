"""Split a route that has more course points than a device takes into parts.

Every part is a file of its own: a stretch of the track with the points that
lie along it. The cuts go where a rider-marked control point sits close to an
even split, otherwise between two points so that the parts carry about the
same number of course points.
"""

import math
import re
from bisect import bisect_right
from dataclasses import dataclass

import gpxpy.gpx
from shapely.geometry import LineString, Point as ShapelyPoint

from .export import DeviceProfile, build_gpx, poi_course_points
from .geometry import local_crs_transformer
from .gpx import Point
from .poi_filter import RankedPoi

# How far from an even split, as a share of the course point limit, a control
# point may lie and still be taken as the cut.
CONTROL_TOLERANCE = 0.15

FALLBACK_NAME = "randoo-pois"


@dataclass(frozen=True)
class ExportPart:
    name: str
    filename: str
    gpx: str


@dataclass(frozen=True)
class _Item:
    position_m: float
    course_points: int
    is_control: bool
    poi: RankedPoi | None = None
    waypoint: gpxpy.gpx.GPXWaypoint | None = None


def part_count(course_points: int, limit: int) -> int:
    return max(1, math.ceil(course_points / limit))


def part_name(name: str, index: int, total: int) -> str:
    """The course name with its place in the series in front, "2.3 Name": a
    slash would not do in a file name."""
    return f"{index}.{total} {name}"


def file_name(name: str) -> str:
    cleaned = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "-", name).strip(" .")
    return f"{cleaned or FALLBACK_NAME}.gpx"


def split_gpx(
    ranked_pois: list[RankedPoi],
    points: list[Point],
    existing_waypoints: list[gpxpy.gpx.GPXWaypoint],
    existing_nsmap: dict[str, str],
    profile: DeviceProfile,
    course_name: str,
    limit: int,
) -> list[ExportPart]:
    """One file per part, each named "<n>.<total> <course name>". A route that
    fits the limit comes back as a single file under the plain name."""
    name = course_name.strip() or FALLBACK_NAME
    parts = split_route(ranked_pois, points, existing_waypoints, profile, limit)
    if len(parts) == 1:
        xml = build_gpx(ranked_pois, [points], existing_waypoints, existing_nsmap, profile, name)
        return [ExportPart(name, file_name(name), xml)]

    result = []
    for index, (part_points, pois, waypoints) in enumerate(parts, start=1):
        numbered = part_name(name, index, len(parts))
        xml = build_gpx(pois, [part_points], waypoints, existing_nsmap, profile, numbered)
        result.append(ExportPart(numbered, file_name(numbered), xml))
    return result


def split_route(
    ranked_pois: list[RankedPoi],
    points: list[Point],
    existing_waypoints: list[gpxpy.gpx.GPXWaypoint],
    profile: DeviceProfile,
    limit: int,
) -> list[tuple[list[Point], list[RankedPoi], list[gpxpy.gpx.GPXWaypoint]]]:
    """The parts as (track points, found points, file waypoints), in route order."""
    to_local, _ = local_crs_transformer(points)
    line = LineString([to_local.transform(p.lon, p.lat) for p in points])
    cumulative = [0.0]
    for (x0, y0), (x1, y1) in zip(line.coords, line.coords[1:]):
        cumulative.append(cumulative[-1] + math.hypot(x1 - x0, y1 - y0))

    def position(lat: float, lon: float) -> float:
        return line.project(ShapelyPoint(*to_local.transform(lon, lat)))

    control_type = profile.point_types.get("control")
    items = [
        _Item(
            position(w.latitude, w.longitude),
            1,
            control_type is not None and w.type == control_type,
            waypoint=w,
        )
        for w in existing_waypoints
    ]
    items += [
        _Item(
            position(r.connector.meeting_point.lat, r.connector.meeting_point.lon),
            poi_course_points(r, profile),
            r.poi.category_id == "control",
            poi=r,
        )
        for r in ranked_pois
    ]
    items.sort(key=lambda item: item.position_m)

    total = sum(item.course_points for item in items)
    count = part_count(total, limit)
    if count == 1:
        return [(points, ranked_pois, existing_waypoints)]

    cuts = _choose_cuts(items, count, limit)

    bounds = [0.0]
    for cut in cuts:
        last, first = items[cut - 1], items[cut]
        bounds.append(last.position_m if last.is_control else (last.position_m + first.position_m) / 2)
    bounds.append(cumulative[-1])
    for i in range(1, len(bounds)):
        bounds[i] = max(bounds[i], bounds[i - 1])

    parts = []
    edges = [0, *cuts, len(items)]
    for i in range(count):
        chunk = items[edges[i] : edges[i + 1]]
        parts.append(
            (
                _slice(points, cumulative, bounds[i], bounds[i + 1]),
                [item.poi for item in chunk if item.poi is not None],
                [item.waypoint for item in chunk if item.waypoint is not None],
            )
        )
    return parts


def _choose_cuts(items: list[_Item], count: int, limit: int) -> list[int]:
    """The index in `items` where each part but the last ends (exclusive). A
    cut keeps every part within the limit where the points allow it; among
    those it takes the control point closest to an even split if one lies
    near enough, otherwise the cut closest to an even split."""
    before = [0]
    for item in items:
        before.append(before[-1] + item.course_points)
    total = before[-1]

    cuts: list[int] = []
    previous = 0
    for k in range(1, count):
        ideal = total * k / count
        upper = len(items) - (count - k)
        candidates = range(previous + 1, upper + 1)
        feasible = [
            c
            for c in candidates
            if before[c] - before[previous] <= limit and total - before[c] <= (count - k) * limit
        ] or list(candidates)

        controls = [
            c
            for c in feasible
            if items[c - 1].is_control and abs(before[c] - ideal) <= CONTROL_TOLERANCE * limit
        ]
        chosen = min(controls or feasible, key=lambda c: abs(before[c] - ideal))
        cuts.append(chosen)
        previous = chosen
    return cuts


def _slice(points: list[Point], cumulative: list[float], start: float, end: float) -> list[Point]:
    inner = [p for p, distance in zip(points, cumulative) if start < distance < end]
    return [_point_at(points, cumulative, start), *inner, _point_at(points, cumulative, end)]


def _point_at(points: list[Point], cumulative: list[float], distance: float) -> Point:
    index = bisect_right(cumulative, distance)
    if index == 0:
        return points[0]
    if index >= len(points):
        return points[-1]
    before, after = cumulative[index - 1], cumulative[index]
    share = (distance - before) / (after - before) if after > before else 0.0
    a, b = points[index - 1], points[index]
    return Point(a.lat + (b.lat - a.lat) * share, a.lon + (b.lon - a.lon) * share)
