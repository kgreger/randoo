"""Geodesic buffering around a GPX track.

Shapely operates on plane coordinates, so buffering directly in lat/lon would
distort distances (a degree of longitude shrinks toward the poles). Web
Mercator, which the map itself uses for display, has the opposite problem —
its distortion grows with latitude, which makes it a poor choice for a metric
buffer. UTM is built for exactly this: pick the 6-degree zone the route
actually sits in and distances within it are accurate to a few parts in
10,000. We project the route line — a line, not the polygon — into whichever
UTM zone covers most of its points, buffer there in metres, and project the
result back to WGS84 for the Overpass query.
"""

from collections import Counter

from shapely.geometry import LineString, Polygon
from shapely.ops import transform
from pyproj import Transformer

from .gpx import Point

# How much a dense GPX track's points get thinned before buffering, capped
# relative to the search radius so thinning never eats a meaningful slice of
# a small radius.
LINE_THIN_TOLERANCE_M = 15.0


def utm_epsg(points: list[Point]) -> int:
    """Pick the UTM zone that best fits the route.

    A route can drift across a zone boundary (each zone is only 6 degrees of
    longitude wide), so this isn't "the zone containing every point" — it's
    the zone containing most of them, which keeps the whole buffer close
    enough to that zone's central meridian to stay accurate.
    """
    zone_numbers = [_utm_zone_number(p.lon) for p in points]
    zone = Counter(zone_numbers).most_common(1)[0][0]

    hemispheres = ["north" if p.lat >= 0 else "south" for p in points]
    northern = Counter(hemispheres).most_common(1)[0][0] == "north"

    return (32600 if northern else 32700) + zone


def _utm_zone_number(lon: float) -> int:
    return int((lon + 180) // 6) + 1


def local_crs_transformer(points: list[Point]) -> tuple[Transformer, Transformer]:
    epsg = utm_epsg(points)
    to_local = Transformer.from_crs("EPSG:4326", f"EPSG:{epsg}", always_xy=True)
    to_wgs84 = Transformer.from_crs(f"EPSG:{epsg}", "EPSG:4326", always_xy=True)
    return to_local, to_wgs84


def route_buffer(points: list[Point], radius_m: float) -> Polygon:
    """Return a polygon covering everything within radius_m of the track (straight-line distance).

    This is a beeline buffer, not a road-network buffer — it can include areas
    that are actually much further away by road. Good enough for a first pass.

    Everything happens in the local UTM projection, in metres: the line gets
    thinned there, buffered there, and simplified there. Only the finished
    polygon is converted back to WGS84 — simplifying after that conversion
    would mean applying a metre-scale tolerance to degree coordinates, wildly
    overshooting and collapsing the polygon.
    """
    if len(points) < 2:
        raise ValueError("need at least two points to build a route buffer")

    to_local, to_wgs84 = local_crs_transformer(points)
    local_coords = [to_local.transform(p.lon, p.lat) for p in points]
    line = LineString(local_coords)

    if len(local_coords) > 2:
        thin_tolerance = min(LINE_THIN_TOLERANCE_M, radius_m * 0.1)
        line = line.simplify(thin_tolerance, preserve_topology=True)

    buffered = line.buffer(radius_m, cap_style="round", join_style="round")
    buffered = _simplify_to_vertex_budget(buffered, radius_m)

    return transform(lambda x, y: to_wgs84.transform(x, y), buffered)


def _simplify_to_vertex_budget(
    polygon: Polygon, radius_m: float, max_vertices: int = 150
) -> Polygon:
    """Cap the polygon's vertex count for a query-sized Overpass poly filter.

    Expects `polygon` in metres (a local projection), since the tolerance
    here is a distance in metres — simplifying a WGS84 polygon with this
    would treat the tolerance as degrees and destroy the shape.
    """
    if len(polygon.exterior.coords) <= max_vertices:
        return polygon

    tolerance_cap = radius_m * 2
    tolerance = max(2.0, radius_m * 0.05)
    simplified = polygon.simplify(tolerance, preserve_topology=True)
    while len(simplified.exterior.coords) > max_vertices and tolerance < tolerance_cap:
        tolerance = min(tolerance * 2, tolerance_cap)
        simplified = polygon.simplify(tolerance, preserve_topology=True)
    return simplified


def bounding_box(polygon: Polygon) -> tuple[float, float, float, float]:
    """Return (south, west, north, east) — the format Overpass expects.

    Sent alongside the polygon itself as a cheap first-pass filter, not as the
    query's only spatial constraint — see poly_filter below.
    """
    minx, miny, maxx, maxy = polygon.bounds
    return miny, minx, maxy, maxx


def poly_filter(polygon: Polygon) -> str:
    """Coordinates for Overpass's `poly:` filter — the actual corridor shape,
    not just its bounding box, so a long diagonal route doesn't turn into a
    search over the whole rectangle spanning it."""
    return " ".join(f"{lat} {lon}" for lon, lat in polygon.exterior.coords)
