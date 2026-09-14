"""Mapping between Randoo's POI categories and the OpenStreetMap tags that back them.

Each category maps to a list of (key, value) tag pairs. A POI matches a category if
it has at least one of the pairs. Keep this list small and easy to extend: adding a
category should never require touching the Overpass query builder.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class Category:
    id: str
    label: str
    tags: tuple[tuple[str, str], ...]


CATEGORIES: tuple[Category, ...] = (
    Category(
        id="water",
        label="Drinking water",
        tags=(("amenity", "drinking_water"), ("natural", "spring")),
    ),
    Category(
        id="fuel",
        label="Fuel station",
        tags=(("amenity", "fuel"),),
    ),
    Category(
        id="bike_shop",
        label="Bike shop / repair",
        tags=(("shop", "bicycle"),),
    ),
    Category(
        id="lodging",
        label="Lodging",
        tags=(("tourism", "hotel"), ("tourism", "guest_house"), ("tourism", "hostel")),
    ),
    Category(
        id="hut",
        label="Hut / shelter",
        tags=(
            ("tourism", "alpine_hut"),
            ("tourism", "wilderness_hut"),
            ("amenity", "shelter"),
        ),
    ),
    Category(
        id="food",
        label="Food & supplies",
        tags=(
            ("amenity", "restaurant"),
            ("amenity", "cafe"),
            ("shop", "supermarket"),
            ("shop", "convenience"),
        ),
    ),
    Category(
        id="rest",
        label="Rest spot",
        tags=(("amenity", "bench"), ("leisure", "picnic_table")),
    ),
)

CATEGORIES_BY_ID: dict[str, Category] = {c.id: c for c in CATEGORIES}


def resolve(category_ids: list[str]) -> list[Category]:
    """Look up categories by id, raising on anything unknown."""
    unknown = [c for c in category_ids if c not in CATEGORIES_BY_ID]
    if unknown:
        raise ValueError(f"unknown categories: {', '.join(unknown)}")
    return [CATEGORIES_BY_ID[c] for c in category_ids]
