from pathlib import Path

import duckdb
import pytest

from randoo import config
from randoo.categories import CATEGORIES_BY_ID
from randoo.gpx import Point
from randoo.overpass import Poi
from randoo.poi_source import LocalPoiSource, OverpassPoiSource, get_poi_source

WATER = [CATEGORIES_BY_ID["water"]]
FOOD = [CATEGORIES_BY_ID["food"]]

# A short route through Düsseldorf - matches the bounding box the fixture
# parquet below is built around.
SEGMENTS = [[Point(51.22, 6.77), Point(51.23, 6.78)]]


@pytest.fixture
def parquet_path(tmp_path: Path) -> Path:
    path = tmp_path / "pois.parquet"
    con = duckdb.connect()
    con.execute(
        f"""
        COPY (
            SELECT * FROM (VALUES
                ('node', 1, 'water', 'In range, right category', '{{}}', 51.225, 6.775),
                ('node', 2, 'food', 'In range, wrong category', '{{}}', 51.225, 6.775),
                ('way', 3, 'water', 'Out of range', '{{}}', 52.0, 7.0)
            ) AS t(osm_type, osm_id, category_id, name, tags, lat, lon)
        ) TO '{path}' (FORMAT PARQUET);
        """
    )
    con.close()
    return path


async def test_local_poi_source_filters_by_bbox_and_category(parquet_path: Path):
    source = LocalPoiSource(parquet_path)
    results = await source.query(SEGMENTS, radius_m=2000, categories=WATER)

    assert len(results) == 1
    poi = results[0]
    assert poi.name == "In range, right category"
    assert poi.osm_type == "node"
    assert isinstance(poi.osm_id, int)
    assert poi.osm_id == 1
    assert poi.tags == {}


async def test_local_poi_source_respects_requested_categories(parquet_path: Path):
    source = LocalPoiSource(parquet_path)
    results = await source.query(SEGMENTS, radius_m=2000, categories=FOOD)

    assert [p.name for p in results] == ["In range, wrong category"]


async def test_overpass_poi_source_delegates_to_query_pois_for_route(monkeypatch):
    captured = {}

    async def fake_query(segments, radius_m, categories):
        captured["args"] = (segments, radius_m, categories)
        return [Poi(osm_id=1, osm_type="node", lat=1.0, lon=2.0, category_id="water", name=None, tags={})]

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
