import json

import duckdb
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


def test_analyze_falls_back_to_overpass_when_the_local_index_is_broken(monkeypatch, client):
    class BrokenLocalSource:
        async def query(self, segments, radius_m, categories):
            raise duckdb.Error("mock: local index unreachable")

    fallback_pois = [
        Poi(osm_id=9, osm_type="node", lat=48.005, lon=8.005, category_id="water", name="Fallback", tags={})
    ]

    class FakeOverpassSource:
        async def query(self, segments, radius_m, categories):
            return fallback_pois

    monkeypatch.setattr(main, "get_poi_source", lambda tier: BrokenLocalSource())
    monkeypatch.setattr(main, "OverpassPoiSource", lambda: FakeOverpassSource())

    files = {"file": ("route.gpx", SAMPLE_GPX, "application/gpx+xml")}
    data = {"categories": "water", "radius_m": "300"}

    response = client.post("/api/analyze", files=files, data=data)

    assert response.status_code == 200
    assert response.json()["pois"][0]["name"] == "Fallback"


def test_export_with_points_uses_them_without_searching(monkeypatch, client):
    calls: list = []
    monkeypatch.setattr(main, "get_poi_source", lambda tier: _fake_source(calls))

    points = [
        {
            "id": "node:7",
            "osm_id": 7,
            "osm_type": "node",
            "lat": 48.004,
            "lon": 8.003,
            "category_id": "water",
            "name": "Saved Spring",
            "distance_to_route_m": 42.0,
            "meeting_point": [48.003, 8.003],
        },
        {
            "id": "node:8",
            "osm_id": 8,
            "osm_type": "node",
            "lat": 48.006,
            "lon": 8.004,
            "category_id": "food",
            "name": "Dropped",
            "distance_to_route_m": 60.0,
            "meeting_point": [48.005, 8.004],
        },
    ]
    response = client.post(
        "/api/export",
        files={"file": ("route.gpx", SAMPLE_GPX, "application/gpx+xml")},
        data={"pois": json.dumps(points), "excluded_poi_ids": "node:8"},
    )

    assert response.status_code == 200
    assert b"Saved Spring" in response.content
    assert b"Dropped" not in response.content
    assert calls == []


def test_export_rejects_malformed_points(client):
    response = client.post(
        "/api/export",
        files={"file": ("route.gpx", SAMPLE_GPX, "application/gpx+xml")},
        data={"pois": "not json"},
    )
    assert response.status_code == 400


def test_export_without_points_or_categories_is_rejected(client):
    response = client.post(
        "/api/export",
        files={"file": ("route.gpx", SAMPLE_GPX, "application/gpx+xml")},
    )
    assert response.status_code == 400


GPX_WITH_WAYPOINTS = b"""<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1"
     xmlns:ext="http://example.com/ext">
  <wpt lat="48.003" lon="8.003">
    <ele>312.5</ele>
    <name>CP1 Start</name>
    <desc>Brevet control</desc>
    <sym>Flag, Red</sym>
    <extensions><ext:opens>08:00</ext:opens></extensions>
  </wpt>
  <wpt lat="48.007" lon="8.007"><name>Old Randoo POI</name><src>Randoo</src></wpt>
  <trk><trkseg>
    <trkpt lat="48.0" lon="8.0"></trkpt>
    <trkpt lat="48.01" lon="8.01"></trkpt>
  </trkseg></trk>
</gpx>
"""


def test_export_keeps_the_waypoints_the_file_already_had(client):
    point = {
        "id": "node:7",
        "osm_id": 7,
        "osm_type": "node",
        "lat": 48.004,
        "lon": 8.003,
        "category_id": "water",
        "name": "Saved Spring",
        "distance_to_route_m": 42.0,
        "meeting_point": [48.003, 8.003],
    }
    response = client.post(
        "/api/export",
        files={"file": ("route.gpx", GPX_WITH_WAYPOINTS, "application/gpx+xml")},
        data={"pois": json.dumps([point])},
    )

    assert response.status_code == 200
    body = response.content.decode()
    assert "CP1 Start" in body
    assert "Brevet control" in body
    assert "Flag, Red" in body
    assert "312.5" in body
    assert "08:00" in body  # the extension survives
    assert "Saved Spring" in body
    # a waypoint an earlier Randoo export wrote is not carried over as the rider's own
    assert "Old Randoo POI" not in body
    # existing waypoints come first, then Randoo's
    assert body.index("CP1 Start") < body.index("Saved Spring")


def test_export_marks_its_own_waypoints_as_generated_by_randoo(client):
    point = {
        "id": "node:7",
        "osm_id": 7,
        "osm_type": "node",
        "lat": 48.004,
        "lon": 8.003,
        "category_id": "water",
        "name": "Saved Spring",
        "distance_to_route_m": 42.0,
        "meeting_point": [48.003, 8.003],
    }
    response = client.post(
        "/api/export",
        files={"file": ("route.gpx", SAMPLE_GPX, "application/gpx+xml")},
        data={"pois": json.dumps([point])},
    )
    assert response.content.decode().count("<src>Randoo</src>") == 2  # the POI and its turnoff marker


GPX_WITH_TWO_CONTROLS = b"""<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">
  <wpt lat="48.003" lon="8.003"><name>CP1</name><sym>Flag, Green</sym></wpt>
  <wpt lat="48.004" lon="8.004"><name>Old Randoo POI</name><src>Randoo</src></wpt>
  <wpt lat="48.007" lon="8.007"><name>CP2</name></wpt>
  <trk><trkseg>
    <trkpt lat="48.0" lon="8.0"></trkpt>
    <trkpt lat="48.01" lon="8.01"></trkpt>
  </trkseg></trk>
</gpx>
"""


def test_export_drops_file_waypoints_the_rider_unticked(client):
    # ids count the file's waypoints without Randoo's own: CP1 is wpt:0, CP2 is wpt:1
    response = client.post(
        "/api/export",
        files={"file": ("route.gpx", GPX_WITH_TWO_CONTROLS, "application/gpx+xml")},
        data={"pois": "[]", "excluded_poi_ids": "wpt:1"},
    )
    body = response.content.decode()
    assert "CP1" in body
    assert "CP2" not in body


def test_export_retypes_file_waypoints_as_control_points(client):
    response = client.post(
        "/api/export",
        files={"file": ("route.gpx", GPX_WITH_TWO_CONTROLS, "application/gpx+xml")},
        data={"pois": "[]", "type_overrides": json.dumps({"wpt:1": "control", "wpt:0": "unknown", "poi:3": "control"})},
    )
    body = response.content.decode()
    cp2 = body[body.index("CP2") - 80 : body.index("CP2") + 120]
    assert "<type>Control</type>" in cp2
    assert "<sym>Flag, Red</sym>" in cp2
    # an unknown type changes nothing: CP1 keeps its own symbol and gets no type
    cp1 = body[body.index("CP1") - 80 : body.index("CP1") + 120]
    assert "<sym>Flag, Green</sym>" in cp1
    assert "<type>" not in cp1


def test_export_rejects_type_overrides_that_are_not_an_object(client):
    response = client.post(
        "/api/export",
        files={"file": ("route.gpx", SAMPLE_GPX, "application/gpx+xml")},
        data={"pois": "[]", "type_overrides": "[1]"},
    )
    assert response.status_code == 400


def test_export_writes_a_retyped_found_point_with_the_control_symbol(client):
    point = {
        "id": "node:7",
        "osm_id": 7,
        "osm_type": "node",
        "lat": 48.004,
        "lon": 8.003,
        "category_id": "control",
        "name": "Spring that is a control",
        "distance_to_route_m": 42.0,
        "meeting_point": [48.003, 8.003],
    }
    response = client.post(
        "/api/export",
        files={"file": ("route.gpx", SAMPLE_GPX, "application/gpx+xml")},
        data={"pois": json.dumps([point])},
    )
    assert response.content.decode().count("<sym>Flag, Red</sym>") == 2  # the point and its turnoff marker
    assert response.content.decode().count("<type>Control</type>") == 2


GPX_WITH_SEGMENTS = b"""<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <trkseg>
      <trkpt lat="48.00" lon="8.00"></trkpt>
      <trkpt lat="48.01" lon="8.01"></trkpt>
    </trkseg>
    <trkseg>
      <trkpt lat="48.01" lon="8.01"></trkpt>
      <trkpt lat="48.02" lon="8.02"></trkpt>
    </trkseg>
    <trkseg>
      <trkpt lat="48.02" lon="8.02"></trkpt>
      <trkpt lat="48.03" lon="8.03"></trkpt>
    </trkseg>
  </trk>
</gpx>
"""


def _export_with_device(client, **device):
    response = client.post(
        "/api/export",
        files={"file": ("route.gpx", GPX_WITH_SEGMENTS, "application/gpx+xml")},
        data={"pois": "[]", **device},
    )
    assert response.status_code == 200
    return response.content.decode()


def test_export_for_garmin_joins_the_segments_into_one_track(client):
    body = _export_with_device(client, device_make="garmin", device_model="edge_840")
    assert body.count("<trkseg>") == 1
    # the shared end and start points are written once: 4 distinct points
    assert body.count("<trkpt ") == 4


def test_export_keeps_the_segments_for_other_makes_or_no_device(client):
    for device in ({}, {"device_make": "wahoo"}, {"device_make": "other", "device_model": "other"}):
        assert _export_with_device(client, **device).count("<trkseg>") == 3


def test_export_ignores_an_unknown_device_make(client):
    assert _export_with_device(client, device_make="unknown").count("<trkseg>") == 3


def _poi_payload(category_id, osm_id):
    return {
        "id": f"node:{osm_id}",
        "osm_id": osm_id,
        "osm_type": "node",
        "lat": 48.004,
        "lon": 8.003,
        "category_id": category_id,
        "name": f"Point {osm_id}",
        "distance_to_route_m": 42.0,
        "meeting_point": [48.003, 8.003],
    }


def test_export_for_garmin_writes_the_course_point_type_of_each_category(client):
    expected = {
        "water": "water",
        "fuel": "store",
        "bike_shop": "service",
        "lodging": "shelter",
        "hut": "shelter",
        "food": "food",
        "rest": "rest_area",
        "control": "checkpoint",
    }
    points = [_poi_payload(category, i) for i, category in enumerate(expected)]
    response = client.post(
        "/api/export",
        files={"file": ("route.gpx", SAMPLE_GPX, "application/gpx+xml")},
        data={"pois": json.dumps(points), "device_make": "garmin", "device_model": "edge_850"},
    )
    body = response.content.decode()
    for i, (category, garmin_type) in enumerate(expected.items()):
        point = body[body.index(f"<name>Point {i}</name>") :]
        point = point[: point.index("</wpt>")]
        assert f"<type>{garmin_type}</type>" in point, category
    # the turnoff markers carry it too
    assert body.count("<type>checkpoint</type>") == 2


def test_shorten_name_cuts_at_a_word_boundary():
    from randoo.export import shorten_name

    assert shorten_name("Bike Shop", 15) == "Bike Shop"
    assert shorten_name("Albert Heijn Rotterdam", 15) == "Albert Heijn"
    assert shorten_name("Stadscafé De Pannekoek", 15) == "Stadscafé De"
    assert shorten_name("Albert Heijn (extra)", 13) == "Albert Heijn"
    # a first word that is too long to keep whole, or has no space, is cut hard
    assert shorten_name("Supercalifragilistic", 15) == "Supercalifragil"
    assert shorten_name("A Supercalifragilistic", 10) == "A Supercal"


def test_export_for_garmin_shortens_the_names_and_marks_the_turnoff_markers(client):
    point = {**_poi_payload("food", 1), "name": "Albert Heijn Rotterdam"}
    response = client.post(
        "/api/export",
        files={"file": ("route.gpx", SAMPLE_GPX, "application/gpx+xml")},
        data={"pois": json.dumps([point]), "device_make": "garmin"},
    )
    body = response.content.decode()
    assert "<name>Albert Heijn</name>" in body
    assert "<name>&gt; Albert Heijn</name>" in body
    # the full name is not lost, it leads the comment
    assert body.count("<cmt>Albert Heijn Rotterdam: food, ") == 2


def test_export_for_garmin_keeps_short_names_whole(client):
    point = {**_poi_payload("food", 1), "name": "Friterie"}
    response = client.post(
        "/api/export",
        files={"file": ("route.gpx", SAMPLE_GPX, "application/gpx+xml")},
        data={"pois": json.dumps([point]), "device_make": "garmin"},
    )
    body = response.content.decode()
    assert "<name>Friterie</name>" in body
    assert "<name>&gt; Friterie</name>" in body
    assert "<cmt>food, " in body


def test_export_for_other_devices_keeps_the_full_names_and_the_turnoff_suffix(client):
    point = {**_poi_payload("food", 1), "name": "Albert Heijn Rotterdam"}
    response = client.post(
        "/api/export",
        files={"file": ("route.gpx", SAMPLE_GPX, "application/gpx+xml")},
        data={"pois": json.dumps([point])},
    )
    body = response.content.decode()
    assert "<name>Albert Heijn Rotterdam</name>" in body
    assert "<name>Albert Heijn Rotterdam (turnoff)</name>" in body


def test_export_for_garmin_retypes_a_file_waypoint_with_the_garmin_control_type(client):
    response = client.post(
        "/api/export",
        files={"file": ("route.gpx", GPX_WITH_TWO_CONTROLS, "application/gpx+xml")},
        data={"pois": "[]", "type_overrides": json.dumps({"wpt:1": "control"}), "device_make": "garmin"},
    )
    body = response.content.decode()
    cp2 = body[body.index("CP2") - 80 : body.index("CP2") + 120]
    assert "<type>checkpoint</type>" in cp2
    assert "<sym>Flag, Red</sym>" in cp2
    assert "<type>Control</type>" not in body


def test_export_for_other_devices_writes_only_the_control_type(client):
    points = [_poi_payload("water", 1), _poi_payload("control", 2)]
    for device in ({}, {"device_make": "wahoo"}):
        response = client.post(
            "/api/export",
            files={"file": ("route.gpx", SAMPLE_GPX, "application/gpx+xml")},
            data={"pois": json.dumps(points), **device},
        )
        body = response.content.decode()
        assert body.count("<type>Control</type>") == 2
        assert "<type>water</type>" not in body
        assert "<type>checkpoint</type>" not in body


def _export_one_point(client, distance_m, **device):
    point = {**_poi_payload("food", 1), "name": "Friterie", "distance_to_route_m": distance_m}
    response = client.post(
        "/api/export",
        files={"file": ("route.gpx", SAMPLE_GPX, "application/gpx+xml")},
        data={"pois": json.dumps([point]), **device},
    )
    assert response.status_code == 200
    return response.content.decode()


def test_export_for_garmin_leaves_out_the_turnoff_marker_of_a_point_near_the_route(client):
    body = _export_one_point(client, 20.0, device_make="garmin")
    assert body.count("<wpt ") == 1
    assert "<name>Friterie</name>" in body
    assert "&gt; Friterie" not in body


def test_export_for_garmin_keeps_the_turnoff_marker_from_the_snap_distance_on(client):
    assert _export_one_point(client, 35.0, device_make="garmin").count("<wpt ") == 1
    assert _export_one_point(client, 35.5, device_make="garmin").count("<wpt ") == 2


def test_export_for_other_devices_always_writes_the_turnoff_marker(client):
    for device in ({}, {"device_make": "wahoo"}):
        assert _export_one_point(client, 5.0, **device).count("<wpt ") == 2


def _export_many_points(client, count, distance_m, **data):
    points = [{**_poi_payload("rest", i), "distance_to_route_m": distance_m} for i in range(count)]
    return client.post(
        "/api/export",
        files={"file": ("route.gpx", SAMPLE_GPX, "application/gpx+xml")},
        data={"pois": json.dumps(points), "device_make": "garmin", **data},
    )


def test_export_for_garmin_accepts_exactly_the_most_course_points(client):
    assert _export_many_points(client, 700, 20.0).status_code == 200


def test_export_for_garmin_asks_before_going_over_the_most_course_points(client):
    response = _export_many_points(client, 701, 20.0)
    assert response.status_code == 409
    assert response.json() == {"code": "too_many_course_points", "course_points": 701, "limit": 700, "parts": 2}


def test_export_for_garmin_counts_a_turnoff_marker_as_a_course_point(client):
    assert _export_many_points(client, 350, 36.0).status_code == 200
    assert _export_many_points(client, 351, 36.0).json()["course_points"] == 702


def test_export_for_garmin_counts_only_the_turnoff_marker_of_a_point_far_off_the_route(client):
    assert _export_many_points(client, 700, 60.0).status_code == 200
    assert _export_many_points(client, 701, 60.0).json()["course_points"] == 701


def test_export_for_garmin_goes_over_the_most_course_points_when_told_to(client):
    assert _export_many_points(client, 701, 20.0, ignore_point_limit="true").status_code == 200


def test_export_for_other_devices_has_no_course_point_limit(client):
    points = [{**_poi_payload("rest", i), "distance_to_route_m": 20.0} for i in range(701)]
    response = client.post(
        "/api/export",
        files={"file": ("route.gpx", SAMPLE_GPX, "application/gpx+xml")},
        data={"pois": json.dumps(points), "device_make": "wahoo"},
    )
    assert response.status_code == 200


def test_export_for_garmin_splits_into_files_named_after_the_course_when_asked(client):
    response = _export_many_points(client, 1000, 20.0, split="true", course_name="Brevet 300")

    assert response.status_code == 200
    parts = response.json()["parts"]
    assert [p["filename"] for p in parts] == ["1.2 Brevet 300.gpx", "2.2 Brevet 300.gpx"]
    assert [p["name"] for p in parts] == ["1.2 Brevet 300", "2.2 Brevet 300"]
    assert [p["gpx"].count("<wpt ") for p in parts] == [500, 500]


def test_export_for_garmin_with_split_and_a_route_within_the_limit_gives_one_file(client):
    response = _export_many_points(client, 10, 20.0, split="true", course_name="Brevet 300")

    assert [p["filename"] for p in response.json()["parts"]] == ["Brevet 300.gpx"]


def test_export_without_a_course_point_limit_ignores_split(client):
    points = [{**_poi_payload("rest", i), "distance_to_route_m": 20.0} for i in range(701)]
    response = client.post(
        "/api/export",
        files={"file": ("route.gpx", SAMPLE_GPX, "application/gpx+xml")},
        data={"pois": json.dumps(points), "device_make": "wahoo", "split": "true"},
    )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/gpx+xml")


def _premium(monkeypatch, refined: list):
    """A premium caller with a stand-in BRouter that routes every POI it is
    asked for, recording which ones."""
    from randoo.gpx import Point
    from randoo.poi_filter import Connector

    class FakeLocator:
        async def refine(self, poi, segments, fallback):
            refined.append(poi.osm_id)
            path = [fallback.meeting_point, Point(48.0, 8.0), Point(poi.lat, poi.lon)]
            return Connector(meeting_point=fallback.meeting_point, path=path)

    async def premium(token):
        return "premium"

    monkeypatch.setattr(main, "get_tier", premium)
    monkeypatch.setattr(main, "routing_available", lambda tier: tier == "premium")
    monkeypatch.setattr(main, "get_turnoff_locator", lambda tier: FakeLocator())


TWO_POIS = [
    Poi(osm_id=1, osm_type="node", lat=48.005, lon=8.005, category_id="water", name="Spring", tags={}),
    Poi(osm_id=2, osm_type="way", lat=48.006, lon=8.006, category_id="food", name="Cafe", tags={}),
]


def test_analyze_answers_with_straight_connectors_and_leaves_routing_for_later(monkeypatch, client):
    refined: list = []
    _premium(monkeypatch, refined)
    monkeypatch.setattr(main, "get_poi_source", lambda tier: _fake_source([], TWO_POIS))

    response = client.post(
        "/api/analyze",
        files={"file": ("route.gpx", SAMPLE_GPX, "application/gpx+xml")},
        data={"categories": ["water", "food"], "radius_m": "300"},
    )

    body = response.json()
    assert body["routing"] is True
    assert body["search_id"]
    assert all(not p["is_routed"] for p in body["pois"])
    assert refined == []


def test_route_connectors_routes_only_the_asked_for_points(monkeypatch, client):
    refined: list = []
    _premium(monkeypatch, refined)
    monkeypatch.setattr(main, "get_poi_source", lambda tier: _fake_source([], TWO_POIS))
    analyze = client.post(
        "/api/analyze",
        files={"file": ("route.gpx", SAMPLE_GPX, "application/gpx+xml")},
        data={"categories": ["water", "food"], "radius_m": "300"},
    ).json()

    response = client.post(
        "/api/route-connectors", json={"search_id": analyze["search_id"], "poi_ids": ["way:2"]}
    )

    assert response.status_code == 200
    (poi,) = response.json()["pois"]
    assert poi["id"] == "way:2"
    assert poi["is_routed"] is True
    assert len(poi["connector_path"]) == 3
    assert refined == [2]


def test_route_connectors_does_not_route_a_point_twice(monkeypatch, client):
    refined: list = []
    _premium(monkeypatch, refined)
    monkeypatch.setattr(main, "get_poi_source", lambda tier: _fake_source([], TWO_POIS))
    files = {"file": ("route.gpx", SAMPLE_GPX, "application/gpx+xml")}
    data = {"categories": ["water", "food"], "radius_m": "300"}
    search_id = client.post("/api/analyze", files=files, data=data).json()["search_id"]

    client.post("/api/route-connectors", json={"search_id": search_id, "poi_ids": ["node:1"]})
    again = client.post("/api/route-connectors", json={"search_id": search_id, "poi_ids": ["node:1"]})

    assert again.json()["pois"][0]["is_routed"] is True
    assert refined == [1]
    # the cached search keeps the routed connector for a later analyze or export
    cached = client.post("/api/analyze", files=files, data=data).json()["pois"]
    assert [p["is_routed"] for p in cached] == [True, False]


def test_route_connectors_reports_an_expired_search(monkeypatch, client):
    _premium(monkeypatch, [])
    response = client.post("/api/route-connectors", json={"search_id": "gone", "poi_ids": ["node:1"]})
    assert response.status_code == 404


def test_route_connectors_is_refused_without_routing(monkeypatch, client):
    monkeypatch.setattr(main, "get_poi_source", lambda tier: _fake_source([], TWO_POIS))
    analyze = client.post(
        "/api/analyze",
        files={"file": ("route.gpx", SAMPLE_GPX, "application/gpx+xml")},
        data={"categories": "water", "radius_m": "300"},
    ).json()
    assert analyze["routing"] is False

    response = client.post(
        "/api/route-connectors", json={"search_id": analyze["search_id"], "poi_ids": ["node:1"]}
    )
    assert response.status_code == 403


def test_route_connectors_takes_a_limited_batch(monkeypatch, client):
    _premium(monkeypatch, [])
    poi_ids = [f"node:{i}" for i in range(main.MAX_ROUTE_BATCH + 1)]
    response = client.post("/api/route-connectors", json={"search_id": "any", "poi_ids": poi_ids})
    assert response.status_code == 400


# About 4.4 km due north, in four equal stretches.
LONG_GPX = b"""<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><trkseg>
    <trkpt lat="48.00" lon="8.0"></trkpt>
    <trkpt lat="48.01" lon="8.0"></trkpt>
    <trkpt lat="48.02" lon="8.0"></trkpt>
    <trkpt lat="48.03" lon="8.0"></trkpt>
    <trkpt lat="48.04" lon="8.0"></trkpt>
  </trkseg></trk>
</gpx>
"""

ALONG_LONG_ROUTE = [
    Poi(osm_id=i, osm_type="node", lat=lat, lon=8.001, category_id="water", name=f"P{i}", tags={})
    for i, lat in enumerate([48.001, 48.015, 48.025, 48.039])
]


def test_analyze_leaves_out_the_skipped_start_and_end_of_the_route(monkeypatch, client):
    searched: list = []

    class RecordingSource:
        async def query(self, segments, radius_m, categories):
            searched.append(segments)
            return ALONG_LONG_ROUTE

    monkeypatch.setattr(main, "get_poi_source", lambda tier: RecordingSource())

    response = client.post(
        "/api/analyze",
        files={"file": ("route.gpx", LONG_GPX, "application/gpx+xml")},
        data={"categories": "water", "radius_m": "200", "skip_start_pct": "10", "skip_end_pct": "5"},
    )

    pois = response.json()["pois"]
    assert [p["name"] for p in pois] == ["P1", "P2"]
    # the route km still counts from the real start
    assert pois[0]["distance_along_route_m"] == pytest.approx(1668, abs=5)
    # the source was only asked about the kept part
    assert searched[0][0][0].lat == pytest.approx(48.004, abs=1e-5)
    assert searched[0][-1][-1].lat == pytest.approx(48.038, abs=1e-5)


def test_analyze_rejects_skipping_too_much_of_the_route(client):
    response = client.post(
        "/api/analyze",
        files={"file": ("route.gpx", LONG_GPX, "application/gpx+xml")},
        data={"categories": "water", "radius_m": "200", "skip_start_pct": "50"},
    )
    assert response.status_code == 400
