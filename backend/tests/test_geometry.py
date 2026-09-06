from shapely.geometry import Point as ShapelyPoint

from randoo.geometry import bounding_box, route_buffer
from randoo.gpx import Point

ROUTE = [Point(48.0, 8.0), Point(48.1, 8.1)]


def test_route_buffer_contains_nearby_point():
    polygon = route_buffer(ROUTE, radius_m=1000)
    # roughly 50m off the route start
    nearby = ShapelyPoint(8.0005, 48.0)
    assert polygon.contains(nearby)


def test_route_buffer_excludes_distant_point():
    polygon = route_buffer(ROUTE, radius_m=500)
    far_away = ShapelyPoint(9.0, 49.0)
    assert not polygon.contains(far_away)


def test_bounding_box_orders_coordinates_correctly():
    polygon = route_buffer(ROUTE, radius_m=500)
    south, west, north, east = bounding_box(polygon)
    assert south < north
    assert west < east
