"""Geodesic buffering around a GPX track.

Shapely operates on plane coordinates, so buffering directly in lat/lon would
distort distances (a degree of longitude shrinks toward the poles). Web
Mercator, which the map itself uses for display, has the opposite problem:
its distortion grows with latitude, which makes it a poor choice for a metric
buffer. UTM is built for exactly this: pick the 6-degree zone the route
actually sits in and distances within it are accurate to a few parts in
10,000. We project the route into whichever UTM zone covers most of its
points, buffer there in metres, and project the result back to WGS84 for the
Overpass query.
"""

from collections import Counter

from shapely.geometry import LineString, Point as ShapelyPoint, Polygon
from shapely.geometry.base import BaseGeometry
from shapely.ops import transform, unary_union
from pyproj import Geod, Transformer

from .gpx import Point

_GEOD = Geod(ellps="WGS84")

# How much a dense GPX track's points get thinned before buffering, capped
# relative to the search radius so thinning never eats a meaningful slice of
# a small radius.
LINE_THIN_TOLERANCE_M = 15.0


def utm_epsg(points: list[Point]) -> int:
    """Pick the UTM zone that best fits the route.

    A route can drift across a zone boundary (each zone is only 6 degrees of
    longitude wide), so this isn't "the zone containing every point", it's
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


def route_buffer(segments: list[list[Point]], radius_m: float) -> BaseGeometry:
    """Return a polygon covering everything within radius_m of the track (straight-line distance).

    This is a beeline buffer, not a road-network buffer: it can include areas
    that are actually much further away by road. Good enough for a first pass.

    Each recorded segment is buffered on its own, in the local UTM projection,
    in metres, never connected to the next segment with a straight line. A
    segment break is a real gap in recording, and two segments can legitimately
    be far apart; bridging them would buffer a corridor through whatever lies
    in between. The result can be a MultiPolygon when segments are genuinely
    far apart, or a single Polygon when they chain together (as they do for
    almost all real rides).

    Simplification happens before the result leaves the local projection:
    doing it after converting back to WGS84 would mean applying a metre-scale
    tolerance to degree coordinates, wildly overshooting and collapsing the
    shape.
    """
    all_points = [p for segment in segments for p in segment]
    if len(all_points) < 2:
        raise ValueError("need at least two points to build a route buffer")

    to_local, to_wgs84 = local_crs_transformer(all_points)
    thin_tolerance = min(LINE_THIN_TOLERANCE_M, radius_m * 0.1)

    segment_buffers = []
    for segment in segments:
        if not segment:
            continue
        local_coords = [to_local.transform(p.lon, p.lat) for p in segment]
        if len(local_coords) == 1:
            shape: BaseGeometry = ShapelyPoint(local_coords[0])
        else:
            shape = LineString(local_coords)
            if len(local_coords) > 2:
                shape = shape.simplify(thin_tolerance, preserve_topology=True)
        segment_buffers.append(shape.buffer(radius_m, cap_style="round", join_style="round"))

    buffered = unary_union(segment_buffers)
    buffered = _simplify_to_vertex_budget(buffered, radius_m)

    return transform(lambda x, y: to_wgs84.transform(x, y), buffered)


def _simplify_to_vertex_budget(geometry: BaseGeometry, radius_m: float, max_vertices: int = 150) -> BaseGeometry:
    """Cap the geometry's vertex count for a query-sized Overpass poly filter.

    Expects `geometry` in metres (a local projection), since the tolerance
    here is a distance in metres: simplifying a WGS84 geometry with this
    would treat the tolerance as degrees and destroy the shape.
    """
    if _vertex_count(geometry) <= max_vertices:
        return geometry

    tolerance_cap = radius_m * 2
    tolerance = max(2.0, radius_m * 0.05)
    simplified = geometry.simplify(tolerance, preserve_topology=True)
    while _vertex_count(simplified) > max_vertices and tolerance < tolerance_cap:
        tolerance = min(tolerance * 2, tolerance_cap)
        simplified = geometry.simplify(tolerance, preserve_topology=True)
    return simplified


def _vertex_count(geometry: BaseGeometry) -> int:
    if geometry.geom_type == "MultiPolygon":
        return sum(len(g.exterior.coords) for g in geometry.geoms)
    return len(geometry.exterior.coords)


def chunk_by_distance(points: list[Point], max_chunk_m: float) -> list[list[Point]]:
    """Split one segment into pieces of roughly max_chunk_m of route length each.

    Distance-based rather than point-count-based, since GPS recording density
    varies wildly between devices and doesn't say anything about how big the
    resulting query's bounding box will be: a chunk should stay a chunk
    whether it was recorded once every 5 metres or once every 50. Consecutive
    chunks share their boundary point so nothing at a chunk edge falls
    through the gap.
    """
    if len(points) < 2:
        return [points] if points else []

    chunks: list[list[Point]] = []
    current = [points[0]]
    current_length = 0.0
    for prev, point in zip(points, points[1:]):
        _, _, step = _GEOD.inv(prev.lon, prev.lat, point.lon, point.lat)
        current.append(point)
        current_length += step
        if current_length >= max_chunk_m:
            chunks.append(current)
            current = [point]
            current_length = 0.0

    if len(current) > 1 or not chunks:
        chunks.append(current)
    return chunks


def bounding_box(geometry: BaseGeometry) -> tuple[float, float, float, float]:
    """Return (south, west, north, east), the format Overpass expects.

    Sent alongside the polygon itself as a cheap first-pass filter, not as the
    query's only spatial constraint (see poly_filter below).
    """
    minx, miny, maxx, maxy = geometry.bounds
    return miny, minx, maxy, maxx


def poly_filter(geometry: BaseGeometry) -> str:
    """Coordinates for Overpass's `poly:` filter: the actual corridor shape,
    not just its bounding box, so a long diagonal route doesn't turn into a
    search over the whole rectangle spanning it.

    Overpass's poly filter only takes a single ring. A MultiPolygon only
    comes up when segments are genuinely disjoint (a real gap in the
    recording, not just a sharp turn), which is rare enough that a convex
    hull is a fine loose pre-filter here; the precise per-segment shape is
    still enforced afterwards against the actual buffer geometry.
    """
    ring = (
        geometry.convex_hull.exterior.coords
        if geometry.geom_type == "MultiPolygon"
        else geometry.exterior.coords
    )
    return " ".join(f"{lat} {lon}" for lon, lat in ring)
