"""GPX parsing helpers."""

from dataclasses import dataclass

import gpxpy
import gpxpy.gpx


class InvalidGpxError(ValueError):
    pass


@dataclass(frozen=True)
class Point:
    lat: float
    lon: float


def parse_track(gpx_bytes: bytes) -> list[Point]:
    """Extract the sequence of track points from a GPX file.

    Falls back to routes, then waypoints, if the file has no tracks — some route
    planners export one or the other. Raises InvalidGpxError if nothing usable
    is found.
    """
    try:
        gpx = gpxpy.parse(gpx_bytes.decode("utf-8"))
    except Exception as exc:
        raise InvalidGpxError(f"could not parse GPX file: {exc}") from exc

    points = [
        Point(p.latitude, p.longitude)
        for track in gpx.tracks
        for segment in track.segments
        for p in segment.points
    ]
    if not points:
        points = [
            Point(p.latitude, p.longitude)
            for route in gpx.routes
            for p in route.points
        ]
    if not points:
        points = [Point(wp.latitude, wp.longitude) for wp in gpx.waypoints]

    if len(points) < 2:
        raise InvalidGpxError("GPX file has no usable track, route, or waypoints")

    return points
