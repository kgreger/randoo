import httpx
import pytest

from randoo import overpass
from randoo.categories import CATEGORIES_BY_ID
from randoo.gpx import Point

WATER = [CATEGORIES_BY_ID["water"]]

NODE_ELEMENT = {
    "type": "node",
    "id": 1,
    "lat": 48.0,
    "lon": 8.0,
    "tags": {"amenity": "drinking_water"},
}


@pytest.fixture(autouse=True)
def _isolated_cache(tmp_path, monkeypatch):
    # Never touch the real cache directory from tests, and keep retry pauses
    # instant instead of waiting on real backoff timers.
    monkeypatch.setattr(overpass, "CACHE_DIR", tmp_path / "cache")
    monkeypatch.setattr(overpass, "RATE_LIMIT_BACKOFF_S", 0.001)


def _client_for(handler) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


async def test_query_pois_parses_matching_elements():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"elements": [NODE_ELEMENT]})

    async with _client_for(handler) as client:
        pois = await overpass.query_pois((47, 7, 49, 9), "47 7 49 9", WATER, client=client)

    assert len(pois) == 1
    assert pois[0].category_id == "water"
    assert pois[0].lat == 48.0


async def test_query_pois_falls_back_to_the_next_endpoint_on_failure():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(str(request.url))
        if str(request.url) == overpass.OVERPASS_ENDPOINTS[0]:
            return httpx.Response(500)
        return httpx.Response(200, json={"elements": [NODE_ELEMENT]})

    async with _client_for(handler) as client:
        pois = await overpass.query_pois((47, 7, 49, 9), "47 7 49 9", WATER, client=client)

    assert len(pois) == 1
    assert calls[0] == overpass.OVERPASS_ENDPOINTS[0]
    assert calls[1] == overpass.OVERPASS_ENDPOINTS[1]


async def test_query_pois_retries_the_same_endpoint_on_429_before_succeeding():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(str(request.url))
        if len(calls) < 3:
            return httpx.Response(429)
        return httpx.Response(200, json={"elements": [NODE_ELEMENT]})

    async with _client_for(handler) as client:
        pois = await overpass.query_pois((47, 7, 49, 9), "47 7 49 9", WATER, client=client)

    assert len(pois) == 1
    # all three calls hit the same (first) endpoint - no need to burn through
    # the others just because the first one is temporarily rate-limiting us
    assert calls == [overpass.OVERPASS_ENDPOINTS[0]] * 3


async def test_query_pois_raises_once_every_endpoint_is_exhausted():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(504)

    async with _client_for(handler) as client:
        with pytest.raises(RuntimeError, match="all Overpass endpoints failed"):
            await overpass.query_pois((47, 7, 49, 9), "47 7 49 9", WATER, client=client)


async def test_query_pois_accepts_an_empty_result_once_every_endpoint_agrees():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(str(request.url))
        return httpx.Response(200, json={"elements": []})

    async with _client_for(handler) as client:
        pois = await overpass.query_pois((47, 7, 49, 9), "47 7 49 9", WATER, client=client)

    assert pois == []
    # every mirror had to weigh in before an empty result was trusted
    assert calls == list(overpass.OVERPASS_ENDPOINTS)


async def test_query_pois_raises_on_an_empty_result_if_another_endpoint_errored():
    def handler(request: httpx.Request) -> httpx.Response:
        if str(request.url) == overpass.OVERPASS_ENDPOINTS[0]:
            return httpx.Response(500)
        return httpx.Response(200, json={"elements": []})

    async with _client_for(handler) as client:
        # A degraded mirror answering "nothing here" can't be told apart
        # from one that's simply broken - this must not come back as a
        # silent, trustworthy zero.
        with pytest.raises(RuntimeError, match="all Overpass endpoints failed"):
            await overpass.query_pois((47, 7, 49, 9), "47 7 49 9", WATER, client=client)


async def test_query_pois_caches_a_successful_response(tmp_path, monkeypatch):
    monkeypatch.setattr(overpass, "CACHE_DIR", tmp_path / "cache")
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(str(request.url))
        return httpx.Response(200, json={"elements": [NODE_ELEMENT]})

    async with _client_for(handler) as client:
        first = await overpass.query_pois((47, 7, 49, 9), "47 7 49 9", WATER, client=client)
        second = await overpass.query_pois((47, 7, 49, 9), "47 7 49 9", WATER, client=client)

    assert first == second
    assert len(calls) == 1  # the second call was served from the cache


async def test_query_pois_for_route_queries_each_chunk_sequentially_and_dedupes():
    # Long enough (~500km) that it needs several 80km chunks.
    segments = [[Point(45.0 + i * 0.05, 8.0) for i in range(101)]]
    request_times: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        request_times.append(request.content.decode())
        return httpx.Response(200, json={"elements": [NODE_ELEMENT]})

    async with _client_for(handler) as client:
        pois = await overpass.query_pois_for_route(segments, radius_m=100, categories=WATER, client=client)

    # more than one chunk query went out ...
    assert len(request_times) > 1
    # ... but the same POI coming back from overlapping chunks was deduped
    assert len(pois) == 1
