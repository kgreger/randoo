import xml.etree.ElementTree as ET

from randoo.export import GARMIN_GPXX_NS, GARMIN_PROXIMITY_M, build_gpx
from randoo.gpx import Point
from randoo.overpass import Poi
from randoo.poi_filter import RankedPoi

GPX_NS = "http://www.topografix.com/GPX/1/1"


def _ranked(
    category_id: str, lat: float, lon: float, distance_m: float, on_route: Point
) -> RankedPoi:
    poi = Poi(
        osm_id=1,
        osm_type="node",
        lat=lat,
        lon=lon,
        category_id=category_id,
        name="Test Spot",
        tags={},
    )
    return RankedPoi(
        poi=poi, distance_to_route_m=distance_m, distance_along_route_m=0.0, nearest_route_point=on_route
    )


def test_export_embeds_the_route_as_a_track_with_one_segment_per_input_segment():
    segments = [
        [Point(48.0, 8.0), Point(48.01, 8.01)],
        [Point(49.0, 9.0), Point(49.01, 9.01)],
    ]
    xml = build_gpx([], segments)
    root = ET.fromstring(xml)

    tracks = root.findall(f"{{{GPX_NS}}}trk")
    assert len(tracks) == 1

    track_segments = tracks[0].findall(f"{{{GPX_NS}}}trkseg")
    assert len(track_segments) == 2
    assert [len(seg.findall(f"{{{GPX_NS}}}trkpt")) for seg in track_segments] == [2, 2]


def test_export_writes_the_real_poi_and_a_snapped_turnoff_marker():
    on_route = Point(48.005, 8.0)
    ranked = [_ranked("water", 48.005, 8.0004, 42.0, on_route)]
    xml = build_gpx(ranked, [[Point(48.0, 8.0), Point(48.01, 8.01)]])
    root = ET.fromstring(xml)

    waypoints = root.findall(f"{{{GPX_NS}}}wpt")
    assert len(waypoints) == 2

    real, turnoff = waypoints
    assert float(real.get("lat")) == 48.005
    assert float(real.get("lon")) == 8.0004
    assert real.find(f"{{{GPX_NS}}}name").text == "Test Spot"

    assert float(turnoff.get("lat")) == on_route.lat
    assert float(turnoff.get("lon")) == on_route.lon
    assert turnoff.find(f"{{{GPX_NS}}}name").text == "Test Spot (turnoff)"

    # both carry a Garmin icon and proximity alert, not just the real one
    for wpt in (real, turnoff):
        assert wpt.find(f"{{{GPX_NS}}}sym").text == "Drinking Water"
        proximity = wpt.find(
            f"{{{GPX_NS}}}extensions/{{{GARMIN_GPXX_NS}}}WaypointExtension/{{{GARMIN_GPXX_NS}}}Proximity"
        )
        assert proximity is not None
        assert float(proximity.text) == GARMIN_PROXIMITY_M


def test_export_falls_back_to_a_generic_symbol_for_categories_without_a_garmin_match():
    ranked = [_ranked("bike_shop", 48.0, 8.0, 10.0, Point(48.0, 8.0))]
    xml = build_gpx(ranked, [[Point(48.0, 8.0), Point(48.01, 8.01)]])
    root = ET.fromstring(xml)

    wpt = root.find(f"{{{GPX_NS}}}wpt")
    assert wpt.find(f"{{{GPX_NS}}}sym").text == "Flag, Blue"
