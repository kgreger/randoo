"""Overpass API client.

Uses a public Overpass instance. Queries are scoped to the route's bounding box
(cheap for Overpass to evaluate) — the caller is responsible for the finer-grained
filter against the actual buffer polygon, since Overpass doesn't take arbitrary
polygons cheaply.
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
    bbox: tuple[float, float, float, float], categories: list[Category]
) -> str:
    south, west, north, east = bbox
    clauses = []
    for cat in categories:
        for key, value in cat.tags:
            clauses.append(f'node["{key}"="{value}"]({south},{west},{north},{east});')
            clauses.append(f'way["{key}"="{value}"]({south},{west},{north},{east});')

    return (
        f"[out:json][timeout:{QUERY_TIMEOUT_S}];\n"
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
    bbox: tuple[float, float, float, float], categories: list[Category]
) -> list[Poi]:
    """Fetch POIs in bbox matching any of the given categories.

    Tries each configured Overpass endpoint in order until one responds.
    """
    query = _build_query(bbox, categories)

    last_error: Exception | None = None
    async with httpx.AsyncClient(timeout=TIMEOUT_S) as client:
        for endpoint in OVERPASS_ENDPOINTS:
            try:
                response = await client.post(endpoint, data={"data": query})
                response.raise_for_status()
                return _parse_elements(response.json()["elements"], categories)
            except (httpx.HTTPError, KeyError) as exc:
                last_error = exc
                continue

    raise RuntimeError(f"all Overpass endpoints failed: {last_error}")


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
