from pathlib import Path

import duckdb
import pytest

from randoo import config
from randoo.categories import CATEGORIES_BY_ID
from randoo.gpx import Point
from randoo.overpass import Poi
from randoo.poi_source import LocalPoiSource, OverpassPoiSource, get_poi_source

WATER = [CATEGORIES_BY_ID["water_tap"]]
FOOD = [CATEGORIES_BY_ID["restaurant"]]

# A short route through Düsseldorf - matches the bounding box the fixture
# parquet below is built around.
SEGMENTS = [[Point(51.22, 6.77), Point(51.23, 6.78)]]


def _write(path: Path, rows_sql: str, columns: str) -> None:
    con = duckdb.connect()
    con.execute(f"COPY (SELECT * FROM (VALUES {rows_sql}) AS t({columns})) TO '{path}' (FORMAT PARQUET);")
    con.close()


@pytest.fixture
def parquet_path(tmp_path: Path) -> Path:
    path = tmp_path / "pois.parquet"
    _write(
        path,
        """
        ('node', 1, 'In range, right category', '{"amenity":"drinking_water"}',
            ['amenity=drinking_water'], 51.225, 6.775),
        ('node', 2, 'In range, wrong category', '{"amenity":"restaurant"}',
            ['amenity=restaurant'], 51.225, 6.775),
        ('way', 3, 'Out of range', '{"amenity":"drinking_water"}',
            ['amenity=drinking_water'], 52.0, 7.0)
        """,
        "osm_type, osm_id, name, tags, primary_tags, lat, lon",
    )
    return path


async def test_local_poi_source_filters_by_bbox_and_category(parquet_path: Path):
    source = LocalPoiSource(parquet_path)
    results = await source.query(SEGMENTS, radius_m=2000, categories=WATER)

    assert len(results) == 1
    poi = results[0]
    assert poi.name == "In range, right category"
    assert poi.category_id == "water_tap"
    assert poi.osm_type == "node"
    assert isinstance(poi.osm_id, int)
    assert poi.osm_id == 1
    assert poi.tags["amenity"] == "drinking_water"


async def test_local_poi_source_respects_requested_categories(parquet_path: Path):
    source = LocalPoiSource(parquet_path)
    results = await source.query(SEGMENTS, radius_m=2000, categories=FOOD)

    assert [p.name for p in results] == ["In range, wrong category"]


async def test_local_poi_source_classifies_each_row_against_all_categories(tmp_path: Path):
    # One row is a hotel that also carries amenity=restaurant. Asking for
    # restaurants must not return it: it is a hotel, whatever was asked for.
    # The two fast-food rows land in different categories by their tags.
    path = tmp_path / "pois.parquet"
    _write(
        path,
        """
        ('node', 1, 'Hotel Zur Post', '{"amenity":"restaurant","tourism":"hotel"}',
            ['amenity=restaurant', 'tourism=hotel'], 51.225, 6.775),
        ('node', 2, 'Burger', '{"amenity":"fast_food","brand":"McDonald''s","cuisine":"burger"}',
            ['amenity=fast_food'], 51.225, 6.775),
        ('node', 3, 'Doener', '{"amenity":"fast_food","cuisine":"kebab"}',
            ['amenity=fast_food'], 51.225, 6.775)
        """,
        "osm_type, osm_id, name, tags, primary_tags, lat, lon",
    )
    source = LocalPoiSource(path)

    assert await source.query(SEGMENTS, radius_m=2000, categories=FOOD) == []
    fast = await source.query(SEGMENTS, radius_m=2000, categories=[CATEGORIES_BY_ID["fast_food"]])
    snack = await source.query(SEGMENTS, radius_m=2000, categories=[CATEGORIES_BY_ID["snack_bar"]])
    assert [p.name for p in fast] == ["Burger"]
    assert [p.name for p in snack] == ["Doener"]


async def test_local_poi_source_reads_a_file_built_before_the_category_tree(tmp_path: Path):
    # Files built by the old pipeline have a category column and no
    # primary_tags; they keep working, classified from the tags they kept.
    path = tmp_path / "pois.parquet"
    _write(
        path,
        """
        ('node', 1, 'water', 'Old spring', '{"natural":"spring"}', 51.225, 6.775),
        ('node', 2, 'food', 'Old cafe', '{"amenity":"cafe"}', 51.225, 6.775)
        """,
        "osm_type, osm_id, category_id, name, tags, lat, lon",
    )
    source = LocalPoiSource(path)

    results = await source.query(SEGMENTS, radius_m=2000, categories=[CATEGORIES_BY_ID["spring"]])
    assert [(p.name, p.category_id) for p in results] == [("Old spring", "spring")]


async def test_local_poi_source_dedupes_the_same_poi_across_regions(tmp_path: Path):
    # A POI near a region boundary can land in more than one region's export
    # (see randoo-infra's regions.py) - same osm_type/osm_id, exported twice.
    # Without dedup this reaches the frontend as two list entries sharing
    # one React key, which corrupts far more than just that one row's render.
    path = tmp_path / "pois.parquet"
    _write(
        path,
        """
        ('node', 1, 'Border spring', '{"amenity":"drinking_water"}', ['amenity=drinking_water'], 51.225, 6.775),
        ('node', 1, 'Border spring', '{"amenity":"drinking_water"}', ['amenity=drinking_water'], 51.225, 6.775)
        """,
        "osm_type, osm_id, name, tags, primary_tags, lat, lon",
    )

    source = LocalPoiSource(path)
    results = await source.query(SEGMENTS, radius_m=2000, categories=WATER)

    assert len(results) == 1


async def test_overpass_poi_source_delegates_to_query_pois_for_route(monkeypatch):
    captured = {}

    async def fake_query(segments, radius_m, categories):
        captured["args"] = (segments, radius_m, categories)
        return [Poi(osm_id=1, osm_type="node", lat=1.0, lon=2.0, category_id="water_tap", name=None, tags={})]

    monkeypatch.setattr("randoo.poi_source.overpass.query_pois_for_route", fake_query)

    source = OverpassPoiSource()
    results = await source.query(SEGMENTS, radius_m=500, categories=WATER)

    assert captured["args"] == (SEGMENTS, 500, WATER)
    assert len(results) == 1


def test_get_poi_source_defaults_to_overpass_for_free_tier(monkeypatch, tmp_path: Path):
    monkeypatch.setattr(config, "LOCAL_POI_PARQUET_PATH", str(tmp_path / "pois.parquet"))
    assert isinstance(get_poi_source("free"), OverpassPoiSource)


def test_get_poi_source_uses_overpass_when_no_local_data_configured(monkeypatch):
    monkeypatch.setattr(config, "LOCAL_POI_PARQUET_PATH", None)
    assert isinstance(get_poi_source("premium"), OverpassPoiSource)


def test_get_poi_source_uses_local_for_premium_tier_with_data_configured(monkeypatch, tmp_path: Path):
    monkeypatch.setattr(config, "LOCAL_POI_PARQUET_PATH", str(tmp_path / "pois.parquet"))
    source = get_poi_source("premium")
    assert isinstance(source, LocalPoiSource)
    assert source.parquet_path == tmp_path / "pois.parquet"


WEEK = (
    '{"v":1,"ws":"2026-11-23","days":[[{"s":540,"e":1080}],[],[],[],[],[],[]],"ph":null}'
)


async def test_local_poi_source_passes_the_parsed_week_through(tmp_path: Path):
    path = tmp_path / "pois.parquet"
    _write(
        path,
        f"""
        ('node', 1, 'Tap', '{{"amenity":"drinking_water","opening_hours":"Mo 09:00-18:00"}}',
            ['amenity=drinking_water'], 51.225, 6.775, '{WEEK}', 'osm'),
        ('node', 2, 'Other tap', '{{"amenity":"drinking_water"}}',
            ['amenity=drinking_water'], 51.226, 6.776, NULL, NULL)
        """,
        "osm_type, osm_id, name, tags, primary_tags, lat, lon, hours_week, hours_source",
    )

    results = await LocalPoiSource(path).query(SEGMENTS, radius_m=2000, categories=WATER)

    by_name = {p.name: p for p in results}
    assert by_name["Tap"].hours_week["days"][0] == [{"s": 540, "e": 1080}]
    assert by_name["Tap"].tags["opening_hours"] == "Mo 09:00-18:00"
    assert by_name["Other tap"].hours_week is None


async def test_local_poi_source_reads_a_file_built_before_hours_were_parsed(parquet_path: Path):
    results = await LocalPoiSource(parquet_path).query(SEGMENTS, radius_m=2000, categories=WATER)

    assert [p.hours_week for p in results] == [None]


@pytest.mark.parametrize("broken", ["not json", "[]", '{"days": []}', '{"days": [[], []]}'])
async def test_a_week_the_app_cannot_read_only_loses_the_chart(tmp_path: Path, broken: str):
    path = tmp_path / "pois.parquet"
    _write(
        path,
        f"""
        ('node', 1, 'Tap', '{{"amenity":"drinking_water"}}',
            ['amenity=drinking_water'], 51.225, 6.775, '{broken}')
        """,
        "osm_type, osm_id, name, tags, primary_tags, lat, lon, hours_week",
    )

    results = await LocalPoiSource(path).query(SEGMENTS, radius_m=2000, categories=WATER)

    assert [(p.name, p.hours_week) for p in results] == [("Tap", None)]
