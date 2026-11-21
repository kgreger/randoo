import pytest

from randoo import categories
from randoo.categories import CATEGORIES, CATEGORIES_BY_ID, GROUPS, classify, resolve


def test_resolve_known_categories():
    result = resolve(["water_tap", "fuel_station"])
    assert [c.id for c in result] == ["water_tap", "fuel_station"]


def test_resolve_rejects_unknown_category():
    with pytest.raises(ValueError, match="unknown categories"):
        resolve(["water_tap", "not_a_category"])


def test_resolve_rejects_the_ids_of_the_old_flat_categories():
    # "water" is a group now, and the old "hut", "food" and "rest" are gone.
    with pytest.raises(ValueError, match="unknown categories: water, hut"):
        resolve(["water", "hut"])


def test_every_category_belongs_to_one_group_and_ids_are_unique():
    assert len(CATEGORIES) == len(CATEGORIES_BY_ID) == 31
    assert [g.id for g in GROUPS] == ["water", "food", "shops", "fuel", "bike", "lodging", "rest"]
    for group in GROUPS:
        assert group.categories, group.id
        assert all(c.group == group.id for c in group.categories)


def test_the_defaults_are_fuel_stations_bakeries_and_bike_shops():
    assert set(categories.DEFAULT_CATEGORY_IDS) == {"fuel_station", "bakery", "bike_shop"}


@pytest.mark.parametrize("category", CATEGORIES, ids=lambda c: c.id)
def test_every_category_can_be_reached_by_its_own_primary_tags(category):
    # A category nobody can ever match would silently show nothing.
    primary = category.primary[0]
    tags = {primary.key: primary.value, **dict(primary.where)}
    found = classify(tags)
    # Another category may win the same tags on purpose (the cemetery tap
    # beats the plain tap only with a cemetery hint), but never nothing.
    assert found is not None


@pytest.mark.parametrize(
    ("tags", "expected"),
    [
        # --- drinking water
        ({"amenity": "drinking_water"}, "water_tap"),
        ({"amenity": "drinking_water", "drinking_water": "no"}, None),
        ({"amenity": "drinking_water", "access": "private"}, None),
        ({"man_made": "water_tap"}, None),  # a tap nobody said is drinkable
        ({"man_made": "water_tap", "drinking_water": "yes"}, "water_tap"),
        ({"amenity": "water_point", "drinking_water": "yes"}, "water_tap"),
        ({"amenity": "fountain"}, None),
        ({"amenity": "fountain", "drinking_water": "no"}, None),
        ({"amenity": "fountain", "drinking_water": "yes"}, "fountain"),
        ({"man_made": "water_well", "drinking_water": "yes"}, "fountain"),
        ({"man_made": "drinking_fountain"}, "fountain"),
        ({"natural": "spring"}, "spring"),
        ({"natural": "spring", "drinking_water": "yes"}, "spring"),
        ({"natural": "spring", "drinking_water": "no"}, None),
        ({"amenity": "drinking_water", "in_cemetery": "yes"}, "cemetery_tap"),
        ({"amenity": "drinking_water", "note": "Wasserstelle Friedhof"}, "cemetery_tap"),
        ({"amenity": "drinking_water", "operator": "Friedhofsamt Grefrath"}, "cemetery_tap"),
        # --- fast food and snack bars never overlap
        ({"amenity": "fast_food", "cuisine": "burger", "brand": "McDonald's"}, "fast_food"),
        ({"amenity": "fast_food", "cuisine": "burger;friture", "brand": "McDonald's"}, "fast_food"),
        ({"amenity": "fast_food", "brand:wikidata": "Q38076"}, "fast_food"),
        ({"amenity": "fast_food", "cuisine": "pizza", "brand": "Domino's"}, "fast_food"),
        ({"amenity": "fast_food", "cuisine": "seafood", "brand": "Nordsee"}, "fast_food"),
        ({"amenity": "fast_food", "cuisine": "kebab", "brand": "Haus des Döners"}, "snack_bar"),
        ({"amenity": "fast_food", "cuisine": "sausage", "brand": "Curry 36"}, "snack_bar"),
        ({"amenity": "fast_food", "cuisine": "kebab;pizza"}, "snack_bar"),
        ({"amenity": "fast_food", "cuisine": "pizza"}, "snack_bar"),
        ({"amenity": "fast_food", "cuisine": "Kebab"}, "snack_bar"),
        ({"amenity": "fast_food", "name": "Imbiss am Schapp"}, "snack_bar"),
        ({"amenity": "fast_food", "cuisine": "burger"}, "fast_food"),
        ({"amenity": "fast_food", "cuisine": "canteen"}, None),
        # --- restaurants
        ({"amenity": "restaurant"}, "restaurant"),
        ({"amenity": "pub"}, "restaurant"),
        ({"amenity": "biergarten"}, "restaurant"),
        ({"amenity": "bar"}, None),
        ({"amenity": "restaurant", "tourism": "hotel"}, "hotel"),
        ({"shop": "bakery", "amenity": "cafe"}, "bakery"),
        # --- huts and shelters
        ({"tourism": "alpine_hut", "name": "SGV-Hütte"}, "hut_open"),
        ({"tourism": "alpine_hut", "amenity": "restaurant"}, "hut_staffed"),
        ({"tourism": "alpine_hut", "phone": "+49 8652 6019901"}, "hut_staffed"),
        ({"tourism": "alpine_hut", "opening_hours": "May-Oct 10:00-17:00"}, "hut_staffed"),
        ({"tourism": "alpine_hut", "website": "https://example.org", "self_service": "yes"}, "hut_open"),
        ({"tourism": "wilderness_hut", "reservation": "required"}, "hut_open"),
        ({"tourism": "wilderness_hut", "access": "private"}, None),
        ({"amenity": "shelter", "shelter_type": "basic_hut"}, "hut_open"),
        ({"amenity": "shelter", "shelter_type": "lean_to"}, "shelter"),
        ({"amenity": "shelter", "shelter_type": "weather_shelter"}, "shelter"),
        ({"amenity": "shelter"}, "shelter"),
        ({"amenity": "shelter", "access": "private"}, None),
        ({"amenity": "shelter", "shelter_type": "public_transport"}, "bus_stop"),
        ({"amenity": "shelter", "bus": "yes"}, "bus_stop"),
        ({"amenity": "shelter", "tourism": "picnic_site"}, "shelter"),
        # --- bus stops count only with a roof
        ({"highway": "bus_stop"}, None),
        ({"highway": "bus_stop", "shelter": "no"}, None),
        ({"highway": "bus_stop", "shelter": "yes"}, "bus_stop"),
        ({"highway": "bus_stop", "covered": "yes"}, "bus_stop"),
        ({"railway": "station"}, "train_station"),
        ({"railway": "halt"}, "train_station"),
        # --- everything else
        ({"amenity": "bench"}, None),
        ({"leisure": "picnic_table"}, "picnic"),
        ({"amenity": "fuel", "shop": "convenience"}, "fuel_station"),
        ({"amenity": "fuel", "access": "private"}, None),
        ({"shop": "convenience"}, "kiosk"),
        ({"shop": "kiosk"}, "kiosk"),
        ({"shop": "deli"}, None),
        ({"shop": "butcher"}, "butcher"),
        ({"shop": "greengrocer"}, "grocery"),
        ({"amenity": "toilets", "fee": "yes"}, "toilet"),
        ({"amenity": "toilets", "access": "customers"}, None),
        ({"amenity": "toilets", "access": "private"}, None),
        ({"amenity": "bicycle_repair_station"}, "bike_repair"),
        ({"tourism": "camp_site"}, "camp_site"),
        ({"tourism": "apartment"}, "guest_house"),
        ({}, None),
    ],
)
def test_classify(tags, expected):
    category = classify(tags)
    assert (category.id if category else None) == expected


def test_primary_pairs_cover_everything_a_rule_can_accept():
    # The data pipeline keeps elements by primary pair and nothing else; a
    # category that could match without one of its pairs would never see data.
    for category in CATEGORIES:
        for primary in category.primary:
            assert primary.pair in categories.primary_pairs()


def test_tag_keys_include_what_the_rules_and_the_interface_read():
    keys = set(categories.tag_keys())
    assert {"name", "opening_hours", "cuisine", "brand", "brand:wikidata", "shelter_type", "in_cemetery"} <= keys
    assert set(categories.ATTRIBUTE_KEYS) <= keys


def test_the_frontends_taxonomy_json_is_the_one_generated_from_this_file():
    import json
    from pathlib import Path

    path = Path(__file__).resolve().parents[2] / "frontend" / "src" / "lib" / "taxonomy.json"
    assert json.loads(path.read_text()) == categories.taxonomy_dict(), (
        "taxonomy.json is out of date: run `python -m randoo.categories > ../frontend/src/lib/taxonomy.json` in backend/"
    )


def test_every_category_and_group_has_a_german_and_an_english_label():
    import json
    from pathlib import Path

    locales = Path(__file__).resolve().parents[2] / "frontend" / "src" / "i18n" / "locales"
    for language in ("de", "en"):
        texts = json.loads((locales / f"{language}.json").read_text())
        for category in CATEGORIES:
            assert texts["categories"].get(category.id), f"{language}: categories.{category.id}"
        for group in GROUPS:
            assert texts["categoryGroups"].get(group.id), f"{language}: categoryGroups.{group.id}"
        # the ids of the old flat categories must not linger as labels of something else
        for old in ("water", "fuel", "hut", "food", "rest", "lodging"):
            assert old not in texts["categories"], f"{language}: categories.{old} is left over"
