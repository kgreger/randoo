import pytest

from randoo.categories import resolve


def test_resolve_known_categories():
    result = resolve(["water", "fuel"])
    assert [c.id for c in result] == ["water", "fuel"]


def test_resolve_rejects_unknown_category():
    with pytest.raises(ValueError, match="unknown categories"):
        resolve(["water", "not_a_category"])
