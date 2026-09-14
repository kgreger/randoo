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


def test_ranked_poi_carries_the_nearest_point_on_the_route():
    # A straight north-south segment - the nearest point to something east
    # of its midpoint should be that midpoint itself, not either endpoint.
    segments = [[Point(48.0, 8.0), Point(48.02, 8.0)]]
    buffer_geometry = route_buffer(segments, radius_m=500)

    east_of_midpoint = _poi(48.01, 8.003)
    ranked = filter_and_rank([east_of_midpoint], segments, buffer_geometry)

    assert len(ranked) == 1
    on_route = ranked[0].nearest_route_point
    assert on_route.lat == pytest.approx(48.01, abs=1e-3)
    assert on_route.lon == pytest.approx(8.0, abs=1e-3)
