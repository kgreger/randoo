import xml.etree.ElementTree as ET

import gpxpy.gpx
import pytest

from randoo.export import DeviceProfile
from randoo.gpx import Point
from randoo.overpass import Poi
from randoo.poi_filter import Connector, RankedPoi
from randoo.split import file_name, part_count, part_name, split_gpx, split_route

GPX_NS = "http://www.topografix.com/GPX/1/1"

# Points within the snap distance get no turnoff marker, so each is one course point.
PROFILE = DeviceProfile(point_types={"control": "checkpoint"}, skip_turnoff_within_m=35.0)

# A straight track from 48.0 to 48.1 north, about 11 km.
TRACK = [Point(48.0 + i / 1000, 8.0) for i in range(101)]


def _poi(osm_id: int, lat: float, category_id: str = "rest") -> RankedPoi:
    poi = Poi(osm_id=osm_id, osm_type="node", lat=lat, lon=8.0001, category_id=category_id, name=f"P{osm_id}", tags={})
    on_route = Point(lat, 8.0)
    return RankedPoi(poi, 10.0, 0.0, Connector(on_route, [on_route, Point(lat, 8.0001)]))


def _pois(count: int) -> list[RankedPoi]:
    return [_poi(i, 48.0005 + i * 0.099 / count) for i in range(count)]


def _waypoint(lat: float, type: str | None = None) -> gpxpy.gpx.GPXWaypoint:
    return gpxpy.gpx.GPXWaypoint(latitude=lat, longitude=8.0, name=f"W{lat}", type=type)


def test_part_count_rounds_up():
    assert part_count(700, 700) == 1
    assert part_count(701, 700) == 2
    assert part_count(1401, 700) == 3


def test_a_route_within_the_limit_stays_one_part():
    parts = split_route(_pois(10), TRACK, [], PROFILE, 10)
    assert len(parts) == 1
    assert parts[0][0] == TRACK


def test_the_points_are_shared_out_evenly_and_none_gets_lost():
    pois = _pois(100)
    parts = split_route(pois, TRACK, [], PROFILE, 40)

    assert [len(p[1]) for p in parts] == [33, 33, 34]
    assert sorted(r.poi.osm_id for _, chunk, _ in parts for r in chunk) == list(range(100))


def test_every_part_follows_on_from_the_one_before():
    parts = split_route(_pois(100), TRACK, [], PROFILE, 40)

    assert parts[0][0][0] == TRACK[0]
    assert parts[-1][0][-1] == TRACK[-1]
    for before, after in zip(parts, parts[1:]):
        assert before[0][-1] == after[0][0]


def test_each_part_holds_the_points_that_lie_along_its_track():
    parts = split_route(_pois(100), TRACK, [], PROFILE, 40)

    for track, pois, _ in parts:
        low, high = track[0].lat, track[-1].lat
        assert all(low <= r.connector.meeting_point.lat <= high for r in pois)


def test_the_cut_goes_to_a_control_point_near_an_even_split():
    pois = _pois(100)
    control = _poi(500, 48.0525, "control")
    parts = split_route([*pois, control], TRACK, [], PROFILE, 60)

    assert len(parts) == 2
    assert parts[0][1][-1] is control
    assert parts[0][0][-1].lat == pytest.approx(48.0525)


def test_a_control_point_far_from_an_even_split_is_still_the_cut():
    pois = _pois(100)
    control = _poi(500, 48.035, "control")
    parts = split_route([*pois, control], TRACK, [], PROFILE, 70)

    assert parts[0][1][-1] is control
    assert len(parts[0][1]) < 40


def test_a_control_point_that_would_leave_a_part_over_the_limit_is_left_alone():
    pois = _pois(100)
    control = _poi(500, 48.0125, "control")
    parts = split_route([*pois, control], TRACK, [], PROFILE, 60)

    assert control not in parts[0][1][-1:]
    assert all(len(p[1]) <= 60 for p in parts)


def test_only_the_controls_that_are_needed_become_cuts():
    pois = _pois(90)
    controls = [_poi(500 + i, 48.0 + (i + 1) * 0.0125, "control") for i in range(7)]
    parts = split_route([*pois, *controls], TRACK, [], PROFILE, 60)

    assert len(parts) == 2
    assert sum(len(p[1]) for p in parts) == 97


def test_a_control_waypoint_from_the_file_can_be_the_cut():
    pois = _pois(100)
    control = _waypoint(48.0525, "checkpoint")
    plain = _waypoint(48.0495)
    parts = split_route(pois, TRACK, [plain, control], PROFILE, 60)

    assert parts[0][2][-1] is control
    assert parts[0][0][-1].lat == pytest.approx(48.0525)
    assert plain in parts[0][2]


def test_a_very_long_route_is_cut_into_several_parts():
    parts = split_route(_pois(100), TRACK, [], PROFILE, 15)

    assert len(parts) == 7
    assert all(len(p[1]) <= 15 for p in parts)


def test_a_point_far_from_the_route_counts_with_its_turnoff_marker():
    profile = DeviceProfile(skip_turnoff_within_m=35.0, drops_beyond_m=40.0)
    near = _pois(10)
    far = [RankedPoi(r.poi, 60.0, 0.0, r.connector) for r in _pois(10)]

    # 10 near points give 10 course points, 10 far ones 10 more (the marker only)
    assert [len(p[1]) for p in split_route(near, TRACK, [], profile, 10)] == [10]
    assert len(split_route([*near, *far], TRACK, [], profile, 10)) == 2


def test_the_parts_are_named_with_their_place_in_the_series():
    assert part_name("Brevet 300", 2, 3) == "2.3 Brevet 300"
    assert part_name("Brevet 300", 2, 11) == "02.11 Brevet 300"
    assert part_name("Brevet 300", 11, 11) == "11.11 Brevet 300"
    assert file_name("2.3 Brevet 300") == "2.3 Brevet 300.gpx"
    assert file_name('Tour: A/B?') == "Tour- A-B-.gpx"
    assert file_name("  ") == "randoo-pois.gpx"


def test_split_gpx_names_the_files_and_tracks_of_the_parts():
    parts = split_gpx(_pois(100), TRACK, [], {}, PROFILE, "Brevet 300", 40)

    assert [p.filename for p in parts] == ["1.3 Brevet 300.gpx", "2.3 Brevet 300.gpx", "3.3 Brevet 300.gpx"]
    root = ET.fromstring(parts[1].gpx)
    assert root.find(f"{{{GPX_NS}}}trk/{{{GPX_NS}}}name").text == "2.3 Brevet 300"
    assert root.find(f"{{{GPX_NS}}}metadata/{{{GPX_NS}}}name").text == "2.3 Brevet 300"
    assert len(root.findall(f"{{{GPX_NS}}}wpt")) == 33


def test_split_gpx_gives_a_route_within_the_limit_its_plain_name():
    parts = split_gpx(_pois(5), TRACK, [], {}, PROFILE, "Brevet 300", 40)

    assert [(p.name, p.filename) for p in parts] == [("Brevet 300", "Brevet 300.gpx")]
