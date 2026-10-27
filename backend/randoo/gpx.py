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


# Written into the <src> of every waypoint Randoo generates, so a file that was
# exported by Randoo and is loaded again doesn't bring those back as if they
# were the rider's own waypoints.
RANDOO_SOURCE = "Randoo"


def parse_existing_waypoints(gpx_bytes: bytes) -> tuple[list[gpxpy.gpx.GPXWaypoint], dict[str, str]]:
    """The waypoints a file already carries (a brevet's controls, say), as they
    were written, plus the namespace prefixes the file declares so their
    extensions can be written back out. Waypoints Randoo itself generated in an
    earlier export are left out. A file that can't be read yields nothing: the
    track parse reports that on its own."""
    try:
        parsed = gpxpy.parse(gpx_bytes.decode("utf-8"))
    except Exception:
        return [], {}
    waypoints = [wp for wp in parsed.waypoints if wp.source != RANDOO_SOURCE]
    return waypoints, dict(parsed.nsmap)


def parse_track(gpx_bytes: bytes) -> list[list[Point]]:
    """Extract the recorded track as a list of segments, each a sequence of points.

    Falls back to routes, then waypoints, if the file has no tracks: some route
    planners export one or the other. Raises InvalidGpxError if nothing usable
    is found.

    Segments are kept separate rather than flattened into one line. A GPX
    track segment break marks a real gap in recording (a paused ride, a lost
    GPS fix, a transfer between two days of a tour), and the two sides of that
    gap can be kilometres apart. Treating them as one continuous line would
    draw a straight connector through whatever lies between, and buffer a
    search corridor along it, including places the rider never actually
    passed, like wherever they stopped to pause the recording.
    """
    try:
        gpx = gpxpy.parse(gpx_bytes.decode("utf-8"))
    except Exception as exc:
        raise InvalidGpxError(f"could not parse GPX file: {exc}") from exc

    segments = [
        [Point(p.latitude, p.longitude) for p in segment.points]
        for track in gpx.tracks
        for segment in track.segments
        if segment.points
    ]

    if not segments:
        route_points = [Point(p.latitude, p.longitude) for route in gpx.routes for p in route.points]
        if route_points:
            segments = [route_points]

    if not segments:
        waypoints = [Point(wp.latitude, wp.longitude) for wp in gpx.waypoints]
        if waypoints:
            segments = [waypoints]

    if sum(len(segment) for segment in segments) < 2:
        raise InvalidGpxError("GPX file has no usable track, route, or waypoints")

    return segments
