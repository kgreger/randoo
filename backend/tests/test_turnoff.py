import httpx
import pytest

from randoo import config
from randoo.gpx import Point
from randoo.overpass import Poi
from randoo.poi_filter import Connector
from randoo.turnoff import (
    BRouterTurnoffLocator,
    GeometricTurnoffLocator,
    _candidate_points,
    get_turnoff_locator,
)

# Captured before any test patches httpx.AsyncClient - see test_entitlements.py
# for why a reference taken after patching would just call itself.
_RealAsyncClient = httpx.AsyncClient


def _mock_async_client(handler):
    return lambda **kwargs: _RealAsyncClient(transport=httpx.MockTransport(handler), **kwargs)


def _poi(lat: float, lon: float) -> Poi:
    return Poi(osm_id=1, osm_type="node", lat=lat, lon=lon, category_id="water", name="Spring", tags={})


def _brouter_response(track_length_m: float, coords: list[tuple[float, float]]) -> httpx.Response:
    return httpx.Response(
        200,
        json={
            "features": [
                {
                    "properties": {"track-length": str(track_length_m)},
                    "geometry": {"type": "LineString", "coordinates": [[lon, lat, 0.0] for lon, lat in coords]},
                }
            ]
        },
    )


FALLBACK = Connector(meeting_point=Point(48.0, 8.005), path=[Point(48.0, 8.005), Point(48.0, 8.006)])
# Points ~150m apart, spanning the fallback's candidate window (300m) around
# its meeting point (8.005) - close enough together that thinning (75m
# spacing) keeps several of them as distinct candidates, unlike two lone
# endpoints far outside the window, which would leave only the fallback
# point itself as a candidate.
SEGMENTS = [[Point(48.0, 8.001 + i * 0.002) for i in range(5)]]


async def test_geometric_locator_always_returns_the_fallback_unchanged():
    locator = GeometricTurnoffLocator()
    result = await locator.refine(_poi(48.0, 8.006), SEGMENTS, FALLBACK)
    assert result is FALLBACK


async def test_brouter_locator_picks_the_shortest_of_several_candidates(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        lonlats = request.url.params["lonlats"]
        from_point = lonlats.split("|")[0]
        # the candidate closest to 8.005 "routes" shortest, arbitrarily but
        # deterministically, so the test can tell which candidate won
        lon = float(from_point.split(",")[0])
        length = abs(lon - 8.005) * 100_000 + 50
        return _brouter_response(length, [(lon, 48.0), (8.006, 48.0)])

    monkeypatch.setattr("randoo.turnoff.httpx.AsyncClient", _mock_async_client(handler))

    locator = BRouterTurnoffLocator(base_url="https://example.test/brouter", profile="trekking")
    result = await locator.refine(_poi(48.0, 8.006), SEGMENTS, FALLBACK)

    assert result.meeting_point.lon == pytest.approx(8.005, abs=1e-6)
    assert result.path[-1] == Point(48.0, 8.006)


async def test_brouter_locator_weighs_in_how_far_a_candidate_is_from_the_route(monkeypatch):
    # The candidate right at the route's nearest point has a merely decent
    # route to the POI (200m); a candidate 300m further along the track has
    # a shorter one (100m) - but reaching it in the first place already
    # costs close to 300m, so picking it would mean a longer ride overall.
    # The nearest point should win once that walk to the candidate counts.
    def handler(request: httpx.Request) -> httpx.Response:
        lonlats = request.url.params["lonlats"]
        lon = float(lonlats.split("|")[0].split(",")[0])
        length = 200.0 if lon == pytest.approx(8.005, abs=1e-6) else 100.0
        return _brouter_response(length, [(lon, 48.0), (8.006, 48.0)])

    monkeypatch.setattr("randoo.turnoff.httpx.AsyncClient", _mock_async_client(handler))

    locator = BRouterTurnoffLocator(base_url="https://example.test/brouter", profile="trekking")
    result = await locator.refine(_poi(48.0, 8.006), SEGMENTS, FALLBACK)

    assert result.meeting_point.lon == pytest.approx(8.005, abs=1e-6)


async def test_brouter_locator_trims_a_routed_path_that_starts_along_the_track(monkeypatch):
    # BRouter's route runs (48.0, 8.005) -> (48.0, 8.0053) -> (48.0, 8.006)
    # -> (48.01, 8.006): the first two legs sit right on SEGMENTS (lat 48.0
    # from lon 8.001 to 8.009), only the last leg actually turns off toward
    # the POI. The anchor itself must stay the connector's start (no gap to
    # the track), the redundant point in between is what should disappear.
    def handler(request: httpx.Request) -> httpx.Response:
        return _brouter_response(1000.0, [(8.005, 48.0), (8.0053, 48.0), (8.006, 48.0), (8.006, 48.01)])

    monkeypatch.setattr("randoo.turnoff.httpx.AsyncClient", _mock_async_client(handler))

    locator = BRouterTurnoffLocator(base_url="https://example.test/brouter", profile="trekking")
    result = await locator.refine(_poi(48.01, 8.006), SEGMENTS, FALLBACK)

    assert result.meeting_point == Point(48.0, 8.005)
    assert result.path == [Point(48.0, 8.005), Point(48.0, 8.006), Point(48.01, 8.006)]


async def test_brouter_locator_anchors_the_path_when_brouter_snaps_the_start_elsewhere(monkeypatch):
    # BRouter answers with a route that starts ~55m off the point we asked
    # from (it snapped to its own nearest graph node) and never comes back
    # near the track before reaching the POI - without anchoring, the drawn
    # connector would visibly stop short of the track instead of touching it.
    def handler(request: httpx.Request) -> httpx.Response:
        return _brouter_response(500.0, [(8.0054, 48.0005), (8.006, 48.0)])

    monkeypatch.setattr("randoo.turnoff.httpx.AsyncClient", _mock_async_client(handler))

    locator = BRouterTurnoffLocator(base_url="https://example.test/brouter", profile="trekking")
    result = await locator.refine(_poi(48.0, 8.006), SEGMENTS, FALLBACK)

    assert result.path[0] == FALLBACK.meeting_point
    assert result.meeting_point == FALLBACK.meeting_point


async def test_brouter_locator_falls_back_when_every_candidate_fails(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500)

    monkeypatch.setattr("randoo.turnoff.httpx.AsyncClient", _mock_async_client(handler))

    locator = BRouterTurnoffLocator(base_url="https://example.test/brouter", profile="trekking")
    result = await locator.refine(_poi(48.0, 8.006), SEGMENTS, FALLBACK)

    assert result is FALLBACK


async def test_brouter_locator_skips_a_failing_candidate_and_uses_a_working_one(monkeypatch):
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(1)
        if len(calls) == 1:
            return httpx.Response(400, text="datafile not found")
        return _brouter_response(123.0, [(8.005, 48.0), (8.006, 48.0)])

    monkeypatch.setattr("randoo.turnoff.httpx.AsyncClient", _mock_async_client(handler))

    locator = BRouterTurnoffLocator(base_url="https://example.test/brouter", profile="trekking")
    result = await locator.refine(_poi(48.0, 8.006), SEGMENTS, FALLBACK)

    assert result is not FALLBACK
    assert result.path[-1] == Point(48.0, 8.006)


def test_candidate_points_always_includes_the_center():
    candidates = _candidate_points([], center=Point(48.0, 8.0))
    assert candidates == [(Point(48.0, 8.0), 0.0)]


def test_candidate_points_stays_within_the_window_and_is_spaced_out():
    # A long straight segment, densely recorded (one point every ~1.1m) -
    # candidates should still come back thinned, not one per input point.
    dense_segment = [Point(48.0, 8.0 + i * 0.00001) for i in range(2000)]
    candidates = _candidate_points([dense_segment], center=Point(48.0, 8.005), window_m=300, spacing_m=75)

    assert len(candidates) < 20
    assert candidates[0] == (Point(48.0, 8.005), 0.0)


def test_get_turnoff_locator_uses_geometric_for_free_tier(monkeypatch):
    monkeypatch.setattr(config, "BROUTER_URL", "https://example.test/brouter")
    assert isinstance(get_turnoff_locator("free"), GeometricTurnoffLocator)


def test_get_turnoff_locator_uses_brouter_for_premium_when_configured(monkeypatch):
    monkeypatch.setattr(config, "BROUTER_URL", "https://example.test/brouter")
    assert isinstance(get_turnoff_locator("premium"), BRouterTurnoffLocator)


def test_get_turnoff_locator_falls_back_when_brouter_is_not_configured(monkeypatch):
    monkeypatch.setattr(config, "BROUTER_URL", None)
    assert isinstance(get_turnoff_locator("premium"), GeometricTurnoffLocator)
