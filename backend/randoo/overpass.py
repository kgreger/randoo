"""Overpass API client.

Uses public Overpass instances. Queries are scoped to the route buffer's
actual shape via Overpass's `poly:` filter, with the bounding box supplied
too as a cheap global pre-filter: bbox alone would search the full rectangle
spanning the route, which for a long or diagonal track is far bigger than the
corridor we actually care about and slow enough to time out.

A long route is also split into chunks before querying (see
query_pois_for_route) and those are queried one at a time, not in parallel.
These are free, shared, rate-limited public instances, and firing several
requests at once is what trips their "too many requests" limit rather than
avoiding it.
"""

import hashlib
import json
import os
import tempfile
import time
from asyncio import sleep
from dataclasses import dataclass
from pathlib import Path

import httpx

from . import geometry
from .categories import Category
from .gpx import Point

OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.osm.ch/api/interpreter",
    "https://overpass.openstreetmap.fr/api/interpreter",
]

TIMEOUT_S = 25
QUERY_TIMEOUT_S = 20

# Overpass's usage policy asks clients to identify themselves (some instances
# also reject the default httpx/urllib user agent outright, 406, as a basic
# bot filter), so a generic library UA won't get past them at all.
USER_AGENT = "randoo-backend/0.1"

# Roughly how much route length goes into one Overpass query. A long touring
# route's own bounding box can span whole countries, and a public instance is
# slow (and prone to its front-end proxy's own gateway timeout, independent
# of our own [timeout:] setting) on a bbox that size regardless of how tight
# the polygon filter inside it is. Kept fairly large on purpose: fewer,
# bigger requests are easier on a rate-limited shared instance than many
# small ones would be.
QUERY_CHUNK_M = 80_000

# A 429 or 504 on a shared public instance is often transient: worth a
# couple of retries with a growing pause before giving up on that endpoint
# and moving to the next one.
MAX_RATE_LIMIT_RETRIES = 3
RATE_LIMIT_BACKOFF_S = 3.0

# Caches raw Overpass responses by exact query text. The same route searched
# again (the common case while testing, or a rider re-running a search after
# tweaking categories) then costs nothing against the shared quota at all.
# OSM's POI data doesn't change fast enough for a few hours of staleness to
# matter here.
CACHE_DIR = Path(os.environ.get("RANDOO_OVERPASS_CACHE_DIR", Path(tempfile.gettempdir()) / "randoo-overpass-cache"))
CACHE_TTL_S = int(os.environ.get("RANDOO_OVERPASS_CACHE_TTL_S", str(6 * 60 * 60)))


@dataclass(frozen=True)
class Poi:
    osm_id: int
    osm_type: str
    lat: float
    lon: float
    category_id: str
    name: str | None
    tags: dict[str, str]


def _build_query(
    bbox: tuple[float, float, float, float],
    poly: str,
    categories: list[Category],
) -> str:
    south, west, north, east = bbox
    clauses = []
    for cat in categories:
        for key, value in cat.tags:
            clauses.append(f'node["{key}"="{value}"](poly:"{poly}");')
            clauses.append(f'way["{key}"="{value}"](poly:"{poly}");')

    return (
        f"[out:json][timeout:{QUERY_TIMEOUT_S}][bbox:{south},{west},{north},{east}];\n"
        f"(\n  {chr(10).join(clauses)}\n);\n"
        "out center tags;"
    )


def _tag_to_category(tags: dict[str, str], categories: list[Category]) -> str | None:
    for cat in categories:
        for key, value in cat.tags:
            if tags.get(key) == value:
                return cat.id
    return None


async def query_pois_for_route(
    segments: list[list[Point]],
    radius_m: float,
    categories: list[Category],
    client: httpx.AsyncClient | None = None,
) -> list[Poi]:
    """Fetch POIs along a route, one chunk of it at a time.

    Splitting a long route into several smaller-bbox queries avoids the
    single-huge-query timeout; running them one after another rather than in
    parallel avoids tripping the concurrent-request limit these free, shared
    instances enforce.
    """
    chunks = [
        chunk for segment in segments for chunk in geometry.chunk_by_distance(segment, QUERY_CHUNK_M)
    ]

    owns_client = client is None
    if owns_client:
        client = httpx.AsyncClient(timeout=TIMEOUT_S, headers={"User-Agent": USER_AGENT})

    try:
        all_pois: list[Poi] = []
        for chunk in chunks:
            buffer_geometry = geometry.route_buffer([chunk], radius_m)
            bbox = geometry.bounding_box(buffer_geometry)
            poly = geometry.poly_filter(buffer_geometry)
            all_pois.extend(await query_pois(bbox, poly, categories, client=client))
    finally:
        if owns_client:
            await client.aclose()

    return dedupe_pois(all_pois)


def dedupe_pois(pois: list[Poi]) -> list[Poi]:
    """Collapse repeat (osm_type, osm_id) entries, keeping the last one seen.

    Adjacent chunks deliberately overlap at their shared boundary point, so
    the same POI can legitimately come back from two chunk queries here.
    LocalPoiSource reuses this too, for a different reason: the same POI can
    land in more than one region's export near a shared border."""
    seen: dict[tuple[str, int], Poi] = {}
    for poi in pois:
        seen[(poi.osm_type, poi.osm_id)] = poi
    return list(seen.values())


async def query_pois(
    bbox: tuple[float, float, float, float],
    poly: str,
    categories: list[Category],
    client: httpx.AsyncClient | None = None,
) -> list[Poi]:
    """Fetch POIs within a route buffer polygon, matching any of the given categories.

    Tries each configured Overpass endpoint in order, retrying an endpoint a
    few times (with a growing pause) if it's rate-limiting us or timing out
    before moving on to the next one. Reuses an already-open client when one
    is passed in, so a chunked route doesn't open a fresh connection per
    chunk.
    """
    query = _build_query(bbox, poly, categories)

    cached = _read_cache(query)
    if cached is not None:
        return _parse_elements(cached, categories)

    owns_client = client is None
    if owns_client:
        client = httpx.AsyncClient(timeout=TIMEOUT_S, headers={"User-Agent": USER_AGENT})

    failures: list[str] = []
    try:
        for endpoint in OVERPASS_ENDPOINTS:
            elements = await _query_endpoint_with_retries(client, endpoint, query, failures)
            if elements is not None:
                _write_cache(query, elements)
                return _parse_elements(elements, categories)
    finally:
        if owns_client:
            await client.aclose()

    raise RuntimeError("all Overpass endpoints failed:\n" + "\n".join(failures))


async def _query_endpoint_with_retries(
    client: httpx.AsyncClient, endpoint: str, query: str, failures: list[str]
) -> list[dict] | None:
    """POST the query to one endpoint, retrying in place on 429/504 before
    giving up on it. Returns the parsed elements, or None if this endpoint
    (eventually) failed, appending a reason to `failures` either way."""
    backoff = RATE_LIMIT_BACKOFF_S
    response: httpx.Response | None = None

    for attempt in range(MAX_RATE_LIMIT_RETRIES + 1):
        try:
            response = await client.post(endpoint, data={"data": query})
        except httpx.HTTPError as exc:
            failures.append(f"{endpoint}: {type(exc).__name__}: {exc!r}")
            return None

        if response.status_code in (429, 504) and attempt < MAX_RATE_LIMIT_RETRIES:
            await sleep(_retry_after_s(response) or backoff)
            backoff *= 2
            continue

        try:
            response.raise_for_status()
            return response.json()["elements"]
        except (httpx.HTTPError, KeyError) as exc:
            failures.append(f"{endpoint}: {type(exc).__name__}: {exc!r}")
            return None

    failures.append(f"{endpoint}: still {response.status_code} after {MAX_RATE_LIMIT_RETRIES + 1} attempts")
    return None


def _retry_after_s(response: httpx.Response) -> float | None:
    header = response.headers.get("Retry-After")
    if header is None:
        return None
    try:
        return float(header)
    except ValueError:
        return None


def _cache_path(query: str) -> Path:
    digest = hashlib.sha256(query.encode("utf-8")).hexdigest()
    return CACHE_DIR / f"{digest}.json"


def _read_cache(query: str) -> list[dict] | None:
    path = _cache_path(query)
    try:
        age_s = time.time() - path.stat().st_mtime
    except FileNotFoundError:
        return None
    if age_s > CACHE_TTL_S:
        return None
    try:
        return json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return None


def _write_cache(query: str, elements: list[dict]) -> None:
    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        _cache_path(query).write_text(json.dumps(elements))
    except OSError:
        pass  # caching is an optimization, not a requirement


def _parse_elements(elements: list[dict], categories: list[Category]) -> list[Poi]:
    pois = []
    for el in elements:
        tags = el.get("tags", {})
        category_id = _tag_to_category(tags, categories)
        if category_id is None:
            continue

        if el["type"] == "node":
            lat, lon = el["lat"], el["lon"]
        else:
            center = el.get("center")
            if center is None:
                continue
            lat, lon = center["lat"], center["lon"]

        pois.append(
            Poi(
                osm_id=el["id"],
                osm_type=el["type"],
                lat=lat,
                lon=lon,
                category_id=category_id,
                name=tags.get("name"),
                tags=tags,
            )
        )
    return pois
