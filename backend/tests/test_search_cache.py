import pytest

from randoo import search_cache


@pytest.fixture(autouse=True)
def _clean_cache():
    search_cache._cache.clear()


def test_get_returns_none_for_an_unknown_key():
    assert search_cache.get("does-not-exist") is None


def test_set_then_get_round_trips():
    key = search_cache.make_key(b"gpx bytes", ["water", "food"], 500, "free")
    search_cache.set(key, ranked=["fake-ranked"], segments=[["fake-segment"]])

    assert search_cache.get(key) == (["fake-ranked"], [["fake-segment"]])


def test_make_key_ignores_category_order():
    key_a = search_cache.make_key(b"gpx", ["water", "food"], 500, "free")
    key_b = search_cache.make_key(b"gpx", ["food", "water"], 500, "free")
    assert key_a == key_b


def test_make_key_differs_on_file_content():
    key_a = search_cache.make_key(b"route one", ["water"], 500, "free")
    key_b = search_cache.make_key(b"route two", ["water"], 500, "free")
    assert key_a != key_b


def test_make_key_differs_on_radius_categories_and_tier():
    base = search_cache.make_key(b"gpx", ["water"], 500, "free")
    assert base != search_cache.make_key(b"gpx", ["food"], 500, "free")
    assert base != search_cache.make_key(b"gpx", ["water"], 300, "free")
    assert base != search_cache.make_key(b"gpx", ["water"], 500, "premium")


def test_entry_expires_after_its_ttl(monkeypatch):
    clock = [1000.0]
    monkeypatch.setattr(search_cache.time, "monotonic", lambda: clock[0])

    key = search_cache.make_key(b"gpx", ["water"], 500, "free")
    search_cache.set(key, ranked=[], segments=[])
    assert search_cache.get(key) is not None

    clock[0] += search_cache._TTL_S + 1
    assert search_cache.get(key) is None
