import pytest

from randoo.geometry import route_buffer
from randoo.gpx import Point
from randoo.overpass import Poi
from randoo.poi_filter import filter_and_rank


def _poi(lat: float, lon: float) -> Poi:
    return Poi(osm_id=1, osm_type="node", lat=lat, lon=lon, category_id="fuel", name="Test", tags={})


def test_poi_near_a_segment_gap_is_excluded():
    # Same paused-and-resumed shape as the geometry test: a POI sitting near
    # the straight line between two segments (not near either segment itself)
    # must not be ranked as if it were near the route.
    first_segment = [Point(48.0, 8.0), Point(48.01, 8.01)]
    second_segment = [Point(49.0, 9.0), Point(49.01, 9.01)]
    segments = [first_segment, second_segment]
    buffer_geometry = route_buffer(segments, radius_m=100)

    midpoint_poi = _poi(48.505, 8.505)
    ranked = filter_and_rank([midpoint_poi], segments, buffer_geometry)
    assert ranked == []


def test_poi_near_the_actual_route_is_kept_and_ranked():
    segments = [[Point(48.0, 8.0), Point(48.01, 8.01)]]
    buffer_geometry = route_buffer(segments, radius_m=200)

    near_start = _poi(48.0, 8.0005)
    ranked = filter_and_rank([near_start], segments, buffer_geometry)
    assert len(ranked) == 1
    assert ranked[0].distance_to_route_m < 200


def test_ranked_pois_are_sorted_by_progress_along_the_route_not_distance_to_it():
    # A straight route running east. A POI right at the start is much
    # farther off-route than one much later on - sorting by distance alone
    # would put the late, close one first. Sorted by where it falls along
    # the route, the early, far one should still come first.
    segments = [[Point(48.0, 8.0), Point(48.0, 8.10)]]
    buffer_geometry = route_buffer(segments, radius_m=2000)

    early_but_far = _poi(48.005, 8.001)  # near the start, ~550m off-route
    late_but_close = _poi(48.0002, 8.09)  # near the end, ~20m off-route

    ranked = filter_and_rank([late_but_close, early_but_far], segments, buffer_geometry)

    assert [r.poi is early_but_far for r in ranked] == [True, False]
    assert ranked[0].distance_along_route_m < ranked[1].distance_along_route_m
    # the far-but-early one is still, correctly, farther off the route
    assert ranked[0].distance_to_route_m > ranked[1].distance_to_route_m


def test_distance_along_route_accumulates_across_segments():
    # Two segments, a real gap between them (a paused-and-resumed ride). A
    # POI near the second segment's own start should show a distance-along
    # past the first segment's full length, not restart from zero.
    first_segment = [Point(48.0, 8.0), Point(48.0, 8.01)]
    second_segment = [Point(49.0, 9.0), Point(49.0, 9.01)]
    segments = [first_segment, second_segment]
    buffer_geometry = route_buffer(segments, radius_m=500)

    near_second_segment_start = _poi(49.0001, 9.0001)
    ranked = filter_and_rank([near_second_segment_start], segments, buffer_geometry)

    assert len(ranked) == 1
    # 0.01 degrees of longitude at latitude 48 is roughly 745m; a safely
    # loose lower bound well past that confirms the first segment's full
    # length was carried over as an offset, not just the local ~10m
    # distance-along-segment within the second one.
    assert ranked[0].distance_along_route_m > 500


def test_ranked_poi_carries_a_geometric_connector_to_the_route():
    # A straight north-south segment - the nearest point to something east
    # of its midpoint should be that midpoint itself, not either endpoint.
    segments = [[Point(48.0, 8.0), Point(48.02, 8.0)]]
    buffer_geometry = route_buffer(segments, radius_m=500)

    east_of_midpoint = _poi(48.01, 8.003)
    ranked = filter_and_rank([east_of_midpoint], segments, buffer_geometry)

    assert len(ranked) == 1
    meeting_point = ranked[0].connector.meeting_point
    assert meeting_point.lat == pytest.approx(48.01, abs=1e-3)
    assert meeting_point.lon == pytest.approx(8.0, abs=1e-3)

    # geometric mode: a straight line, meeting point to the POI itself
    assert ranked[0].connector.path == [meeting_point, Point(east_of_midpoint.lat, east_of_midpoint.lon)]
