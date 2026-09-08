from shapely.geometry import Point as ShapelyPoint

from randoo.geometry import bounding_box, poly_filter, route_buffer
from randoo.gpx import Point

ROUTE = [Point(48.0, 8.0), Point(48.1, 8.1)]

# A long, wiggly route (~1500 points) — the kind that used to produce a
# buffer polygon with thousands of vertices before simplification.
LONG_WIGGLY_ROUTE = [
    Point(47.0 + i * 0.001, 7.0 + i * 0.0015 + (0.0003 if i % 2 == 0 else -0.0003))
    for i in range(1500)
]


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


def test_poly_filter_formats_as_lat_lon_pairs():
    polygon = route_buffer(ROUTE, radius_m=500)
    poly = poly_filter(polygon)
    parts = poly.split(" ")
    assert len(parts) % 2 == 0
    # first pair should look like plausible lat/lon, not lon/lat
    lat, lon = float(parts[0]), float(parts[1])
    assert 47 < lat < 49
    assert 7 < lon < 9


def test_long_route_buffer_stays_within_vertex_budget():
    polygon = route_buffer(LONG_WIGGLY_ROUTE, radius_m=500)
    assert len(polygon.exterior.coords) <= 300
