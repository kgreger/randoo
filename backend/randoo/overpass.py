"""Overpass API client.

Uses a public Overpass instance. Queries are scoped to the route buffer's
actual shape via Overpass's `poly:` filter, with the bounding box supplied
too as a cheap global pre-filter — bbox alone would search the full rectangle
spanning the route, which for a long or diagonal track is far bigger than the
corridor we actually care about and slow enough to time out.
"""

from dataclasses import dataclass

import httpx

from .categories import Category

OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]

TIMEOUT_S = 25
QUERY_TIMEOUT_S = 20

# Overpass's usage policy asks clients to identify themselves — some instances
# also reject the default httpx/urllib user agent outright (406) as a basic
# bot filter, so a generic library UA won't get past them at all.
USER_AGENT = "randoo-backend/0.1"


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


async def query_pois(
    bbox: tuple[float, float, float, float],
    poly: str,
    categories: list[Category],
) -> list[Poi]:
    """Fetch POIs within the route buffer polygon, matching any of the given categories.

    Tries each configured Overpass endpoint in order until one responds.
    """
    query = _build_query(bbox, poly, categories)

    failures: list[str] = []
    async with httpx.AsyncClient(
        timeout=TIMEOUT_S, headers={"User-Agent": USER_AGENT}
    ) as client:
        for endpoint in OVERPASS_ENDPOINTS:
            try:
                response = await client.post(endpoint, data={"data": query})
                response.raise_for_status()
                return _parse_elements(response.json()["elements"], categories)
            except (httpx.HTTPError, KeyError) as exc:
                failures.append(f"{endpoint}: {type(exc).__name__}: {exc!r}")
                continue

    raise RuntimeError("all Overpass endpoints failed:\n" + "\n".join(failures))


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
