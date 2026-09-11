from pyproj import Geod
from shapely.geometry import LineString, Point as ShapelyPoint

from randoo.geometry import (
    _simplify_to_vertex_budget,
    bounding_box,
    poly_filter,
    route_buffer,
    utm_epsg,
)
from randoo.gpx import Point

METERS_PER_DEGREE_LAT = 111_320

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
    assert len(polygon.exterior.coords) <= 150


def test_simplify_skips_polygons_already_under_budget():
    # A plain two-point buffer has far fewer vertices than the budget —
    # simplifying it anyway would only add pointless distortion.
    line = LineString([(0, 0), (1000, 1000)])
    buffered = line.buffer(100, cap_style="round", join_style="round")
    assert _simplify_to_vertex_budget(buffered, radius_m=100) is buffered


def test_utm_epsg_picks_zone_32n_for_southwest_germany():
    # Freiburg-ish coordinates — squarely zone 32N.
    assert utm_epsg(ROUTE) == 32632


def test_utm_epsg_picks_zone_33n_for_eastern_germany():
    dresden_ish = [Point(51.0, 13.7), Point(51.1, 13.8)]
    assert utm_epsg(dresden_ish) == 32633


def test_utm_epsg_follows_point_majority_across_a_zone_boundary():
    # Mostly in zone 32 (up to 12°E), a handful of points just into zone 33.
    points = [Point(48.0, 7.0 + i * 0.1) for i in range(55)] + [
        Point(48.0, 12.5 + i * 0.1) for i in range(5)
    ]
    assert utm_epsg(points) == 32632


def test_utm_epsg_picks_southern_hemisphere_zone():
    santiago_ish = [Point(-33.4, -70.6), Point(-33.5, -70.7)]
    assert utm_epsg(santiago_ish) == 32719


def test_far_end_of_long_route_stays_geodesically_accurate():
    # ~600km, north-east, crossing a UTM zone boundary along the way — long
    # enough that a projection with its scale centered elsewhere would drift
    # by the time you reach either end.
    long_route = [Point(47.0 + i * (5.0 / 200), 7.0 + i * (6.0 / 200)) for i in range(201)]
    radius_m = 100
    polygon = route_buffer(long_route, radius_m=radius_m)

    geod = Geod(ellps="WGS84")
    far_end = long_route[-1]

    def true_distance_to_far_end(lat: float, lon: float) -> float:
        _, _, distance = geod.inv(far_end.lon, far_end.lat, lon, lat)
        return distance

    inside_lat = far_end.lat + (radius_m - 20) / METERS_PER_DEGREE_LAT
    assert true_distance_to_far_end(inside_lat, far_end.lon) < radius_m
    assert polygon.contains(ShapelyPoint(far_end.lon, inside_lat))

    outside_lat = far_end.lat + (radius_m + 100) / METERS_PER_DEGREE_LAT
    assert true_distance_to_far_end(outside_lat, far_end.lon) > radius_m
    assert not polygon.contains(ShapelyPoint(far_end.lon, outside_lat))


def test_simplify_tolerance_scales_with_radius():
    # A deliberately complex line so simplification actually has to kick in.
    line = LineString([(i * 10, (i % 2) * 30) for i in range(400)])
    buffered = line.buffer(100, cap_style="round", join_style="round")
    simplified = _simplify_to_vertex_budget(buffered, radius_m=100, max_vertices=50)

    # A fixed 50m tolerance (the previous behaviour) on a 100m search radius
    # can bulge the boundary out by close to half the radius — exactly what
    # let POIs well outside the requested distance turn up in results. The
    # radius-scaled tolerance should stay far tighter than that.
    deviation = simplified.hausdorff_distance(buffered)
    assert deviation < 20
