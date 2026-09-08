"""Geodesic buffering around a GPX track.

Shapely operates on plane coordinates, so buffering directly in lat/lon would
distort distances (a degree of longitude shrinks toward the poles). We project
into a local azimuthal-equidistant CRS centered on the track, buffer there in
metres, then project the result back to WGS84 for the Overpass query.
"""

from shapely.geometry import LineString, Polygon
from shapely.ops import transform
from pyproj import Transformer

from .gpx import Point


def local_crs_transformer(points: list[Point]) -> tuple[Transformer, Transformer]:
    lat0 = sum(p.lat for p in points) / len(points)
    lon0 = sum(p.lon for p in points) / len(points)
    proj = f"+proj=aeqd +lat_0={lat0} +lon_0={lon0} +units=m +datum=WGS84"
    to_local = Transformer.from_crs("EPSG:4326", proj, always_xy=True)
    to_wgs84 = Transformer.from_crs(proj, "EPSG:4326", always_xy=True)
    return to_local, to_wgs84


def route_buffer(points: list[Point], radius_m: float) -> Polygon:
    """Return a polygon covering everything within radius_m of the track (straight-line distance).

    This is a beeline buffer, not a road-network buffer — it can include areas
    that are actually much further away by road. Good enough for a first pass.

    Simplified in the local metric CRS (50m tolerance, tightened further if the
    route is complex enough to still leave an unwieldy vertex count) — a long
    or winding track otherwise produces a buffer with thousands of points,
    which is both wasteful to ship to Overpass and slow for it to evaluate.
    """
    to_local, to_wgs84 = local_crs_transformer(points)

    local_coords = [to_local.transform(p.lon, p.lat) for p in points]
    line = LineString(local_coords)
    buffered = line.buffer(radius_m, cap_style="round", join_style="round")
    buffered = _simplify_to_vertex_budget(buffered)

    return transform(lambda x, y: to_wgs84.transform(x, y), buffered)


def _simplify_to_vertex_budget(polygon: Polygon, max_vertices: int = 300) -> Polygon:
    tolerance = 50.0
    simplified = polygon.simplify(tolerance, preserve_topology=True)
    while len(simplified.exterior.coords) > max_vertices and tolerance < 1000:
        tolerance *= 2
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
