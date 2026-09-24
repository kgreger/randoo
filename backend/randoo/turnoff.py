"""Refines a POI's connector from a straight line to a real routed path.

Two implementations behind one interface, same shape as poi_source.py:
GeometricTurnoffLocator just keeps whatever filter_and_rank already computed
(always available, free tier); BRouterTurnoffLocator asks a BRouter instance
for the actual shortest bike route from a handful of candidate points on the
route to the POI, and keeps whichever candidate routed shortest. Every
failure (network, no route found, BRouter down) falls back to the geometric
connector already in hand - a search or export must never fail just because
a routing call didn't come back.

BRouter has no matrix/table endpoint for "one point against many" the way
Overpass or OSRM do, so this is genuinely N point-to-point requests per POI,
one per candidate - see _candidate_points for how that N is kept small. All
of them, across every POI in a search, run concurrently rather than one at
a time - main.py's own POI loop does the same - capped by _request_semaphore
so a POI-heavy search doesn't burst thousands of requests at once against
the self-hosted instance in one go.
"""

import asyncio
import httpx
from pyproj import Geod
from shapely.geometry import LineString, Point as ShapelyPoint
from typing import Protocol

from . import config
from .entitlements import PREMIUM
from .geometry import local_crs_transformer
from .gpx import Point
from .overpass import Poi
from .poi_filter import Connector

_GEOD = Geod(ellps="WGS84")

# Caps concurrent BRouter requests process-wide (every POI's every
# candidate, across every search in flight), not per-search - a self-hosted
# instance handles concurrent load well (an 80-request burst against it
# came back clean, no failures), but a fully unbounded gather over a
# POI-heavy search could still throw thousands of requests at it at once.
# Raised from 40 (2026-09-24): a real, dense-route search against the
# production instance still took long enough to hit the reverse proxy's
# timeout, even though neither BRouter nor this service were anywhere near
# their CPU/memory limits at the time - the bottleneck was this cap itself,
# not the instance's actual capacity.
_MAX_CONCURRENT_REQUESTS = 100
_request_semaphore = asyncio.Semaphore(_MAX_CONCURRENT_REQUESTS)

# How close a routed point has to sit to the recorded track to still count as
# "on the route" when trimming a path's redundant leading stretch - loose
# enough to absorb the gap between the track as recorded and the road/path
# BRouter actually routes along.
_ON_ROUTE_TOLERANCE_M = 20.0

# How far from the geometric meeting point to look for a real turnoff, and
# how far apart candidates should be within that window - not a global
# search for the true shortest route, just a local one around where the
# beeline already suggests. A real shortest access point far outside this
# window (blocked by a river with no nearby bridge, say) would be missed;
# good enough for a plausible, real turnoff instead of one drawn through
# whatever terrain lies between the route and the POI.
_CANDIDATE_WINDOW_M = 300.0
_CANDIDATE_SPACING_M = 75.0

# Raised from 10s (2026-09-24): BRouter serializes its own route
# computation internally (see the "contention! ms waited" lines in its own
# log), so a dense cluster of POIs - many concurrent requests competing for
# that same internal queue - can genuinely take BRouter past 10s to even
# start on a given request, not because anything's actually stuck. This
# client gave up before BRouter finished writing the response ("Broken
# pipe" on BRouter's own side), losing a route that would have come back
# fine with a little more patience. Concurrency across POIs/candidates
# already keeps the *overall* search fast; this only affects how long any
# one contended request is allowed to wait its turn.
_REQUEST_TIMEOUT_S = 30.0


class TurnoffLocator(Protocol):
    async def refine(
        self, poi: Poi, segments: list[list[Point]], fallback: Connector
    ) -> Connector: ...


class GeometricTurnoffLocator:
    """The free-tier default: the straight-line connector filter_and_rank
    already computed, unchanged."""

    async def refine(
        self, poi: Poi, segments: list[list[Point]], fallback: Connector
    ) -> Connector:
        return fallback


class BRouterTurnoffLocator:
    def __init__(self, base_url: str, profile: str):
        self._base_url = base_url
        self._profile = profile

    async def refine(
        self, poi: Poi, segments: list[list[Point]], fallback: Connector
    ) -> Connector:
        candidates = _candidate_points(segments, fallback.meeting_point)

        async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT_S) as client:
            results = await asyncio.gather(
                *(self._route_candidate(client, candidate, offset_m, poi) for candidate, offset_m in candidates)
            )

        best: tuple[float, Connector] | None = None
        for result in results:
            if result is None:
                continue
            total_m, connector = result
            if best is None or total_m < best[0]:
                best = (total_m, connector)

        if best is None:
            return fallback
        return _trim_to_route_departure(best[1], segments)

    async def _route_candidate(
        self, client: httpx.AsyncClient, candidate: Point, offset_m: float, poi: Poi
    ) -> tuple[float, Connector] | None:
        async with _request_semaphore:
            try:
                distance_m, path = await self._route(client, candidate, poi)
            except (httpx.HTTPError, KeyError, ValueError, IndexError):
                return None
        # The candidate's own distance from the route's nearest point counts
        # too - a candidate further along the track needs a shorter routed
        # leg to actually win, otherwise the "shortest" pick would happily
        # send the rider backtracking along the track itself just to shave a
        # little off the POI-side route.
        return offset_m + distance_m, Connector(meeting_point=candidate, path=path)

    async def _route(
        self, client: httpx.AsyncClient, from_point: Point, to_poi: Poi
    ) -> tuple[float, list[Point]]:
        response = await client.get(
            self._base_url,
            params={
                "lonlats": f"{from_point.lon},{from_point.lat}|{to_poi.lon},{to_poi.lat}",
                "profile": self._profile,
                "alternativeidx": 0,
                "format": "geojson",
            },
        )
        response.raise_for_status()
        feature = response.json()["features"][0]
        distance_m = float(feature["properties"]["track-length"])
        path = [Point(lat, lon) for lon, lat, *_ in feature["geometry"]["coordinates"]]

        # BRouter snaps the requested start to the nearest routable node in
        # its own road graph, which can sit a little off the point we asked
        # from - anchor the path to the point actually on our track instead,
        # so the drawn connector never leaves a visible gap before it.
        if not path or path[0] != from_point:
            path.insert(0, from_point)

        return distance_m, path


def _trim_to_route_departure(connector: Connector, segments: list[list[Point]]) -> Connector:
    """A routed path can legitimately start by following the recorded track
    itself for a stretch - real road, just redundant to show, since the
    rider is already on it - before actually turning off toward the POI.
    Cuts that redundant middle away: keeps the exact anchor point (see
    _route) as the very first point no matter what, so the connector always
    visibly touches the track with no gap, and jumps straight from there to
    the last point still essentially on the route, skipping past whatever
    lies between instead of drawing through the whole overlapping stretch.

    Deliberately never changes where the connector starts (meeting_point,
    already the exact anchor) - only which of the path's own points get
    drawn between that anchor and the real departure.
    """
    path = connector.path
    if len(path) < 2:
        return connector

    # One shared projection for both the track and the routed path - each
    # built in its own local CRS, distances between the two would be
    # meaningless even where the numbers happen to look plausible.
    to_local, _ = local_crs_transformer([p for segment in segments for p in segment] + path)
    lines = [
        LineString([to_local.transform(p.lon, p.lat) for p in segment])
        for segment in segments
        if len(segment) > 1
    ]
    if not lines:
        return connector

    # Never past len(path) - 2: the POI itself (the last point) always stays,
    # even on the rare route where it sits within tolerance of the track too.
    last_on_route = 0
    for i, point in enumerate(path[:-1]):
        local_point = ShapelyPoint(to_local.transform(point.lon, point.lat))
        if min(line.distance(local_point) for line in lines) <= _ON_ROUTE_TOLERANCE_M:
            last_on_route = i

    # <= 1 covers "nothing to skip" (0) and "skipping just the point right
    # after the anchor" (1, where keeping it changes nothing) alike.
    if last_on_route <= 1:
        return connector
    trimmed = [path[0], *path[last_on_route:]]
    return Connector(meeting_point=connector.meeting_point, path=trimmed)


def _candidate_points(
    segments: list[list[Point]],
    center: Point,
    window_m: float = _CANDIDATE_WINDOW_M,
    spacing_m: float = _CANDIDATE_SPACING_M,
) -> list[tuple[Point, float]]:
    """Route points within window_m of center, thinned to roughly spacing_m
    apart - regardless of how densely the original track was recorded, so a
    GPS log with a point every few metres doesn't just hand back a dozen
    near-duplicates from the same few metres of road. Always includes center
    itself first, so a BRouter outage that fails every other candidate still
    leaves the geometric point as one of the (failed) attempts rather than
    skipped outright.

    Each candidate is paired with its own distance from center, so a caller
    can weigh "how far along the track is this candidate" against "how short
    is its route from here" instead of judging candidates on the routed leg
    alone.
    """
    candidates = [(center, 0.0)]
    last_kept = center
    for segment in segments:
        for point in segment:
            _, _, from_center = _GEOD.inv(center.lon, center.lat, point.lon, point.lat)
            if from_center > window_m:
                continue
            _, _, from_last = _GEOD.inv(last_kept.lon, last_kept.lat, point.lon, point.lat)
            if from_last < spacing_m:
                continue
            candidates.append((point, from_center))
            last_kept = point
    return candidates


def get_turnoff_locator(tier: str) -> TurnoffLocator:
    if tier == PREMIUM and config.BROUTER_URL:
        return BRouterTurnoffLocator(config.BROUTER_URL, config.BROUTER_PROFILE)
    return GeometricTurnoffLocator()
