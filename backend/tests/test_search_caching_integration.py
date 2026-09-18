import pytest
from fastapi.testclient import TestClient

from randoo import main, search_cache
from randoo.auth import require_user
from randoo.overpass import Poi

SAMPLE_GPX = b"""<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><trkseg>
    <trkpt lat="48.0" lon="8.0"></trkpt>
    <trkpt lat="48.01" lon="8.01"></trkpt>
  </trkseg></trk>
</gpx>
"""


@pytest.fixture(autouse=True)
def _clean_cache():
    search_cache._cache.clear()


@pytest.fixture
def client():
    main.app.dependency_overrides[require_user] = lambda: {"sub": "test-user"}
    yield TestClient(main.app)
    main.app.dependency_overrides.clear()


def _fake_source(calls: list, pois: list[Poi] | None = None):
    default_pois = [
        Poi(osm_id=1, osm_type="node", lat=48.005, lon=8.005, category_id="water", name="Spring", tags={})
    ]

    class FakeSource:
        async def query(self, segments, radius_m, categories):
            calls.append((radius_m, tuple(c.id for c in categories)))
            return pois if pois is not None else default_pois

    return FakeSource()


def test_export_reuses_the_analyze_result_instead_of_requerying(monkeypatch, client):
    calls: list = []
    monkeypatch.setattr(main, "get_poi_source", lambda tier: _fake_source(calls))

    files = {"file": ("route.gpx", SAMPLE_GPX, "application/gpx+xml")}
    data = {"categories": "water", "radius_m": "300"}

    analyze_response = client.post("/api/analyze", files=files, data=data)
    assert analyze_response.status_code == 200
    assert len(analyze_response.json()["pois"]) == 1

    export_response = client.post("/api/export", files=files, data=data)
    assert export_response.status_code == 200
    assert export_response.content  # a real GPX body came back, not an error

    # the source was only ever queried once - export was served from the cache
    assert len(calls) == 1


def test_a_different_radius_is_not_served_from_the_same_cache_entry(monkeypatch, client):
    calls: list = []
    monkeypatch.setattr(main, "get_poi_source", lambda tier: _fake_source(calls))

    files = {"file": ("route.gpx", SAMPLE_GPX, "application/gpx+xml")}

    client.post("/api/analyze", files=files, data={"categories": "water", "radius_m": "300"})
    client.post("/api/export", files=files, data={"categories": "water", "radius_m": "500"})

    assert len(calls) == 2


def test_analyze_returns_a_stable_id_export_can_exclude_by(monkeypatch, client):
    pois = [
        Poi(osm_id=1, osm_type="node", lat=48.005, lon=8.005, category_id="water", name="Spring", tags={}),
        Poi(osm_id=2, osm_type="way", lat=48.006, lon=8.006, category_id="food", name="Cafe", tags={}),
    ]
    monkeypatch.setattr(main, "get_poi_source", lambda tier: _fake_source([], pois))

    files = {"file": ("route.gpx", SAMPLE_GPX, "application/gpx+xml")}
    data = {"categories": ["water", "food"], "radius_m": "300"}

    analyze_response = client.post("/api/analyze", files=files, data=data)
    returned = analyze_response.json()["pois"]
    assert {p["id"] for p in returned} == {"node:1", "way:2"}

    export_response = client.post(
        "/api/export", files=files, data={**data, "excluded_poi_ids": ["node:1"]}
    )
    assert export_response.status_code == 200
    xml = export_response.text
    assert "Spring" not in xml
    assert "Cafe" in xml


def test_analyze_includes_the_connector_for_map_rendering(monkeypatch, client):
    pois = [
        Poi(osm_id=1, osm_type="node", lat=48.005, lon=8.005, category_id="water", name="Spring", tags={}),
    ]
    monkeypatch.setattr(main, "get_poi_source", lambda tier: _fake_source([], pois))

    files = {"file": ("route.gpx", SAMPLE_GPX, "application/gpx+xml")}
    data = {"categories": "water", "radius_m": "300"}

    response = client.post("/api/analyze", files=files, data=data)
    poi = response.json()["pois"][0]

    assert poi["is_routed"] is False  # free tier: no BRouter locator configured for this test
    assert len(poi["meeting_point"]) == 2
    # geometric mode: a straight two-point line, meeting point to the POI
    assert poi["connector_path"] == [poi["meeting_point"], [poi["lat"], poi["lon"]]]
    # exposed for the frontend's route-km display - exact value is
    # poi_filter.py's job to get right, this just checks it made it out
    assert poi["distance_along_route_m"] > 0


def test_export_without_exclusions_includes_every_poi(monkeypatch, client):
    pois = [
        Poi(osm_id=1, osm_type="node", lat=48.005, lon=8.005, category_id="water", name="Spring", tags={}),
    ]
    monkeypatch.setattr(main, "get_poi_source", lambda tier: _fake_source([], pois))

    files = {"file": ("route.gpx", SAMPLE_GPX, "application/gpx+xml")}
    data = {"categories": "water", "radius_m": "300"}

    client.post("/api/analyze", files=files, data=data)
    export_response = client.post("/api/export", files=files, data=data)

    assert "Spring" in export_response.text
