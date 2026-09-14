"""Where POI candidates for a search actually come from.

Two implementations behind one interface: OverpassPoiSource queries the
public Overpass API live (the free tier, always available); LocalPoiSource
reads a locally maintained Parquet file instead, for premium searches once
that data exists (see the randoo-infra repository for how the file gets
built and kept current). poi_filter.py does the real category/distance
filtering afterward regardless of which one answered, so a source only has
to return a reasonable candidate set, not a precise one - the same contract
Overpass's own bbox/poly prefilter already has today.
"""

import asyncio
import json
from pathlib import Path
from typing import Protocol

import duckdb

from . import config, geometry, overpass
from .categories import Category
from .entitlements import PREMIUM
from .gpx import Point
from .overpass import Poi


class PoiSource(Protocol):
    async def query(
        self, segments: list[list[Point]], radius_m: float, categories: list[Category]
    ) -> list[Poi]: ...


class OverpassPoiSource:
    """The free-tier source: queries the public Overpass API live."""

    async def query(
        self, segments: list[list[Point]], radius_m: float, categories: list[Category]
    ) -> list[Poi]:
        return await overpass.query_pois_for_route(segments, radius_m, categories)


class LocalPoiSource:
    """Reads POIs from a locally maintained Parquet file instead of querying
    Overpass live. Only pre-filters by bounding box; poi_filter.py still does
    the precise polygon and distance check against whatever this returns.
    """

    def __init__(self, parquet_path: Path):
        self.parquet_path = parquet_path

    async def query(
        self, segments: list[list[Point]], radius_m: float, categories: list[Category]
    ) -> list[Poi]:
        buffer_geometry = geometry.route_buffer(segments, radius_m)
        south, west, north, east = geometry.bounding_box(buffer_geometry)
        category_ids = [c.id for c in categories]
        # DuckDB's Python client is synchronous; the query itself is fast
        # (a local Parquet scan), but running it in a thread keeps a slow
        # disk or a big file from blocking other requests' event loop turns.
        return await asyncio.to_thread(self._query_sync, south, west, north, east, category_ids)

    def _query_sync(
        self, south: float, west: float, north: float, east: float, category_ids: list[str]
    ) -> list[Poi]:
        # category_ids only ever come from categories.resolve(), which
        # raises on anything not in our own fixed CATEGORIES list - safe to
        # inline, the same reasoning randoo-infra's export uses for its own
        # category CASE expression built from that same source.
        category_list = ", ".join(f"'{cid}'" for cid in category_ids)
        con = duckdb.connect()
        try:
            rows = con.execute(
                f"""
                SELECT osm_type, osm_id, category_id, name, tags, lat, lon
                FROM read_parquet(?)
                WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?
                  AND category_id IN ({category_list})
                """,
                [str(self.parquet_path), south, north, west, east],
            ).fetchall()
        finally:
            con.close()

        return [
            Poi(
                osm_type=osm_type,
                osm_id=osm_id,
                lat=lat,
                lon=lon,
                category_id=category_id,
                name=name,
                tags=json.loads(tags) if tags else {},
            )
            for osm_type, osm_id, category_id, name, tags, lat, lon in rows
        ]


def get_poi_source(tier: str) -> PoiSource:
    """Which source answers a search, given the caller's tier (see
    entitlements.get_tier).

    A premium tier alone isn't enough: RANDOO_LOCAL_POI_PARQUET_PATH also has
    to be configured, so a deployment with no local data yet (or a caller
    who isn't premium) always falls back to the free-tier Overpass path.
    """
    if tier == PREMIUM and config.LOCAL_POI_PARQUET_PATH:
        return LocalPoiSource(Path(config.LOCAL_POI_PARQUET_PATH))
    return OverpassPoiSource()
