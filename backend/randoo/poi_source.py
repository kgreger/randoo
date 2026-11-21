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
from .categories import Category, classify
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
        # DuckDB's Python client is synchronous; the query itself is fast
        # (a local Parquet scan), but running it in a thread keeps a slow
        # disk or a big file from blocking other requests' event loop turns.
        return await asyncio.to_thread(self._query_sync, south, west, north, east, categories)

    def _query_sync(
        self, south: float, west: float, north: float, east: float, categories: list[Category]
    ) -> list[Poi]:
        selected = {c.id for c in categories}
        con = duckdb.connect()
        try:
            columns = {
                row[0]
                for row in con.execute("DESCRIBE SELECT * FROM read_parquet(?)", [str(self.parquet_path)]).fetchall()
            }
            if "primary_tags" in columns:
                # Current format: each row lists the "key=value" pairs that made it
                # a candidate, so the file can be narrowed to the selection before
                # the rules decide which category a row really belongs to.
                pairs = sorted({f"{key}={value}" for c in categories for key, value in c.tags})
                rows = con.execute(
                    """
                    SELECT osm_type, osm_id, name, tags, lat, lon
                    FROM read_parquet(?)
                    WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?
                      AND list_has_any(primary_tags, ?)
                    """,
                    [str(self.parquet_path), south, north, west, east, pairs],
                ).fetchall()
            else:
                # A file built before the category tree existed: its rows only
                # carry the old category column, so everything inside the box is
                # read and classified from the tags it kept.
                rows = con.execute(
                    """
                    SELECT osm_type, osm_id, name, tags, lat, lon
                    FROM read_parquet(?)
                    WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?
                    """,
                    [str(self.parquet_path), south, north, west, east],
                ).fetchall()
        finally:
            con.close()

        pois = []
        for osm_type, osm_id, name, tags, lat, lon in rows:
            tag_dict = json.loads(tags) if tags else {}
            if name and "name" not in tag_dict:
                tag_dict["name"] = name
            category = classify(tag_dict)
            if category is None or category.id not in selected:
                continue
            pois.append(
                Poi(
                    osm_type=osm_type,
                    osm_id=osm_id,
                    lat=lat,
                    lon=lon,
                    category_id=category.id,
                    name=name,
                    tags=tag_dict,
                )
            )
        return overpass.dedupe_pois(pois)


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
