"""Randoo's POI categories: seven groups, each with a few specific kinds of place.

A category (a "leaf" of the tree the rider sees) is defined by

- `primary`: the OSM tag pairs an element must carry to be a candidate at all.
  These are what a query asks Overpass for and what the data pipeline keeps;
  a pair can carry extra `where` conditions that narrow the query (a bus stop
  only counts with a shelter).
- `rule`: a refinement over the element's tags (see poi_rules.py), for the
  cases a single tag pair cannot decide, such as the difference between a
  snack bar and a fast-food chain.
- `priority`: when an element fits several categories, the lowest number wins.
  Every element lands in at most one category, whichever categories the rider
  selected, so a hotel with a restaurant does not turn into a restaurant just
  because only restaurants were asked for.

The reasoning behind each category is written down in docs/poi-categories.md.
The frontend gets the tree from taxonomy.json, which is generated from this
file (see taxonomy_dict) and checked by a test.
"""

from dataclasses import dataclass, field

from .poi_rules import ALWAYS, Rule, Tags, eq, has, lacks, text, tok


@dataclass(frozen=True)
class Primary:
    key: str
    value: str
    where: tuple[tuple[str, str], ...] = ()

    def matches(self, tags: Tags) -> bool:
        return tags.get(self.key) == self.value and all(tags.get(k) == v for k, v in self.where)

    @property
    def pair(self) -> str:
        return f"{self.key}={self.value}"


@dataclass(frozen=True)
class Category:
    id: str
    group: str
    label: str
    primary: tuple[Primary, ...]
    rule: Rule = ALWAYS
    priority: int = 50
    default: bool = False

    @property
    def tags(self) -> tuple[tuple[str, str], ...]:
        """The distinct (key, value) pairs that make an element a candidate."""
        return tuple(dict.fromkeys((p.key, p.value) for p in self.primary))

    def matches(self, tags: Tags) -> bool:
        return any(p.matches(tags) for p in self.primary) and self.rule(tags)


@dataclass(frozen=True)
class Group:
    id: str
    label: str
    categories: tuple[Category, ...] = field(default=())


def _p(key: str, value: str, **where: str) -> Primary:
    return Primary(key, value, tuple(where.items()))


# --- shared building blocks -------------------------------------------------

# Water: drinking_water=no means exactly that, whatever else the tags say.
NOT_DRINKABLE = eq("drinking_water", "no", "none", "legal:no")
# Places the public cannot walk up to.
NO_PUBLIC_ACCESS = eq("access", "private", "no")
# Toilets are only worth a detour if anyone may use them.
NO_FREE_TOILET = eq("access", "private", "no", "customers", "permit")

# A hut with a landlord: food and drink, opening hours, a reservation, or a
# number to call. Huts with none of that are for self-supplied riders.
STAFFED_HUT = ~eq("self_service", "yes") & (
    eq("amenity", "restaurant", "pub", "cafe", "biergarten")
    | has("opening_hours", "website", "phone", "contact:phone", "contact:website")
    | eq("food", "yes")
    | eq("drink", "yes")
    | eq("reservation", "yes", "required", "recommended")
)

# A shelter mapped next to a road for bus passengers.
BUS_SHELTER = eq("shelter_type", "public_transport") | eq("bus", "yes") | has("public_transport")

# Fast food and snack bars share amenity=fast_food and are told apart so that
# no element is both. A branded outlet is Fast Food unless its cuisine says
# doner, sausage or something regional; an outlet without a brand is a snack
# bar when its cuisine is a typical snack-bar one, or when it names none.
IS_CHAIN = has("brand", "brand:wikidata")
CANTEEN = tok("cuisine", "canteen")
SNACK_BAR_PROTECTED_CUISINES = (
    "kebab", "doner", "döner", "gyros", "falafel", "turkish", "arab", "lebanese",
    "syrian", "oriental", "balkan", "sausage", "currywurst", "german", "regional", "bavarian",
)  # fmt: skip
SNACK_BAR_CUISINES = SNACK_BAR_PROTECTED_CUISINES + (
    "pizza", "italian", "italian_pizza", "greek", "asian", "chinese", "vietnamese", "thai",
    "indian", "japanese", "korean", "sushi", "noodle", "noodles", "ramen", "fries", "friture",
    "fish", "fish_and_chips", "seafood", "chicken", "barbecue", "grill", "wok",
)  # fmt: skip
FAST_FOOD_BY_BRAND = IS_CHAIN & ~tok("cuisine", *SNACK_BAR_PROTECTED_CUISINES)
SNACK_BAR = ~CANTEEN & ~FAST_FOOD_BY_BRAND & (
    tok("cuisine", *SNACK_BAR_CUISINES) | (lacks("cuisine") & ~IS_CHAIN)
)  # fmt: skip

# --- the tree ---------------------------------------------------------------

GROUPS: tuple[Group, ...] = (
    Group(
        "water",
        "Drinking water",
        (
            Category(
                "water_tap",
                "water",
                "Drinking water tap",
                (
                    _p("amenity", "drinking_water"),
                    _p("man_made", "water_tap", drinking_water="yes"),
                    _p("amenity", "water_point", drinking_water="yes"),
                ),
                ~NOT_DRINKABLE & ~NO_PUBLIC_ACCESS,
            ),
            Category(
                "fountain",
                "water",
                "Fountain or well with drinking water",
                (
                    _p("amenity", "fountain", drinking_water="yes"),
                    _p("man_made", "water_well", drinking_water="yes"),
                    _p("man_made", "drinking_fountain"),
                ),
                ~NOT_DRINKABLE & ~NO_PUBLIC_ACCESS,
            ),
            Category(
                "spring",
                "water",
                "Spring",
                (_p("natural", "spring"),),
                ~NOT_DRINKABLE,
            ),
            Category(
                "cemetery_tap",
                "water",
                "Cemetery tap",
                (
                    _p("amenity", "drinking_water"),
                    _p("man_made", "water_tap", drinking_water="yes"),
                    _p("amenity", "water_point", drinking_water="yes"),
                ),
                ~NOT_DRINKABLE
                & ~NO_PUBLIC_ACCESS
                & (
                    eq("in_cemetery", "yes")
                    | text(("name", "operator", "description", "note"), "friedhof", "cemetery", "kerkhof", "begraafplaats")
                ),
                priority=10,
            ),
        ),
    ),
    Group(
        "food",
        "Food & drink",
        (
            Category(
                "restaurant",
                "food",
                "Restaurant, pub or beer garden",
                (_p("amenity", "restaurant"), _p("amenity", "pub"), _p("amenity", "biergarten")),
                ~NO_PUBLIC_ACCESS,
            ),
            Category(
                "fast_food",
                "food",
                "Fast food",
                (_p("amenity", "fast_food"),),
                ~CANTEEN & ~SNACK_BAR,
            ),
            Category(
                "snack_bar",
                "food",
                "Snack bar",
                (_p("amenity", "fast_food"),),
                SNACK_BAR,
            ),
            Category("cafe", "food", "Café", (_p("amenity", "cafe"),)),
            Category(
                "ice_cream",
                "food",
                "Ice cream",
                (_p("amenity", "ice_cream"), _p("shop", "ice_cream")),
            ),
            Category("bakery", "food", "Bakery", (_p("shop", "bakery"),), priority=45, default=True),
            Category("butcher", "food", "Butcher", (_p("shop", "butcher"),), priority=45),
        ),
    ),
    Group(
        "shops",
        "Shops",
        (
            Category("supermarket", "shops", "Supermarket", (_p("shop", "supermarket"),)),
            Category(
                "kiosk",
                "shops",
                "Kiosk or convenience store",
                (_p("shop", "kiosk"), _p("shop", "convenience")),
                priority=60,
            ),
            Category(
                "grocery",
                "shops",
                "Small grocery or farm shop",
                (_p("shop", "greengrocer"), _p("shop", "farm"), _p("shop", "general")),
                priority=60,
            ),
        ),
    ),
    Group(
        "fuel",
        "Fuel",
        (
            Category(
                "fuel_station",
                "fuel",
                "Fuel station",
                (_p("amenity", "fuel"),),
                ~NO_PUBLIC_ACCESS,
                priority=40,
                default=True,
            ),
        ),
    ),
    Group(
        "bike",
        "Bicycle",
        (
            Category("bike_shop", "bike", "Bike shop", (_p("shop", "bicycle"),), default=True),
            Category(
                "bike_repair",
                "bike",
                "Bike repair station",
                (_p("amenity", "bicycle_repair_station"),),
                ~NO_PUBLIC_ACCESS,
            ),
        ),
    ),
    Group(
        "lodging",
        "Sleeping",
        (
            Category(
                "hotel",
                "lodging",
                "Hotel",
                (_p("tourism", "hotel"), _p("tourism", "motel")),
                priority=30,
            ),
            Category(
                "guest_house",
                "lodging",
                "Guest house or holiday flat",
                (_p("tourism", "guest_house"), _p("tourism", "apartment"), _p("tourism", "chalet")),
                priority=30,
            ),
            Category("hostel", "lodging", "Hostel", (_p("tourism", "hostel"),), priority=30),
            Category("camp_site", "lodging", "Camp site", (_p("tourism", "camp_site"),), priority=30),
            Category(
                "hut_staffed",
                "lodging",
                "Staffed mountain hut",
                (_p("tourism", "alpine_hut"),),
                STAFFED_HUT & ~NO_PUBLIC_ACCESS,
                priority=10,
            ),
        ),
    ),
    Group(
        "rest",
        "Shelter, rest & services",
        (
            Category(
                "shelter",
                "rest",
                "Shelter",
                (_p("amenity", "shelter"),),
                ~NO_PUBLIC_ACCESS & ~tok("shelter_type", "basic_hut"),
            ),
            Category(
                "hut_open",
                "rest",
                "Open hut or bivouac",
                (
                    _p("tourism", "wilderness_hut"),
                    _p("tourism", "alpine_hut"),
                    _p("amenity", "shelter", shelter_type="basic_hut"),
                ),
                ~NO_PUBLIC_ACCESS & (eq("tourism", "wilderness_hut") | eq("amenity", "shelter") | ~STAFFED_HUT),
                priority=20,
            ),
            Category(
                "bus_stop",
                "rest",
                "Bus stop with shelter",
                (
                    _p("highway", "bus_stop", shelter="yes"),
                    _p("highway", "bus_stop", covered="yes"),
                    _p("amenity", "shelter"),
                ),
                eq("highway", "bus_stop") | BUS_SHELTER,
                priority=10,
            ),
            Category(
                "train_station",
                "rest",
                "Railway station",
                (_p("railway", "station"), _p("railway", "halt")),
            ),
            Category(
                "picnic",
                "rest",
                "Picnic spot",
                (_p("leisure", "picnic_table"), _p("tourism", "picnic_site")),
                ~NO_PUBLIC_ACCESS,
                priority=70,
            ),
            Category("toilet", "rest", "Toilet", (_p("amenity", "toilets"),), ~NO_FREE_TOILET),
            Category("shower", "rest", "Shower", (_p("amenity", "shower"),), ~NO_PUBLIC_ACCESS),
            Category("pharmacy", "rest", "Pharmacy", (_p("amenity", "pharmacy"),)),
            Category("atm", "rest", "Cash machine", (_p("amenity", "atm"),)),
        ),
    ),
)

CATEGORIES: tuple[Category, ...] = tuple(c for g in GROUPS for c in g.categories)
CATEGORIES_BY_ID: dict[str, Category] = {c.id: c for c in CATEGORIES}
GROUPS_BY_ID: dict[str, Group] = {g.id: g for g in GROUPS}
DEFAULT_CATEGORY_IDS: tuple[str, ...] = tuple(c.id for c in CATEGORIES if c.default)

# Tags that travel with a POI to the rider's screen and into saved plans: the
# opening hours as written, plus the few attributes the interface shows as
# badges (a fuel station with a shop, a toilet that costs money, a spring
# nobody has checked).
ATTRIBUTE_KEYS: tuple[str, ...] = ("drinking_water", "fee", "shop", "access", "seasonal")

# The order in which categories are tried when classifying an element: lowest
# priority number first, definition order among equals.
_BY_PRIORITY: tuple[Category, ...] = tuple(sorted(CATEGORIES, key=lambda c: c.priority))
_CANDIDATES: dict[str, list[Category]] = {}
for _category in _BY_PRIORITY:
    for _primary in _category.primary:
        bucket = _CANDIDATES.setdefault(_primary.pair, [])
        if _category not in bucket:
            bucket.append(_category)


def classify(tags: Tags) -> Category | None:
    """The one category an element belongs to, or None. Whichever categories a
    search asks for, every element is classified against all of them, so the
    same element always gets the same answer."""
    candidates: dict[str, Category] = {}
    for key, value in tags.items():
        for category in _CANDIDATES.get(f"{key}={value}", ()):
            candidates[category.id] = category
    for category in sorted(candidates.values(), key=lambda c: (c.priority, _ORDER[c.id])):
        if category.matches(tags):
            return category
    return None


_ORDER: dict[str, int] = {c.id: i for i, c in enumerate(CATEGORIES)}


MAX_ATTRIBUTE_LENGTH = 200


def poi_attributes(tags: Tags) -> dict[str, str]:
    """The interface attributes of an element: the whitelisted tags it has,
    as short strings."""
    return {key: tags[key][:MAX_ATTRIBUTE_LENGTH] for key in ATTRIBUTE_KEYS if tags.get(key)}


def poi_opening_hours(tags: Tags) -> str | None:
    """The opening hours exactly as mapped (OSM's own opening_hours syntax)."""
    value = tags.get("opening_hours")
    return value[:MAX_ATTRIBUTE_LENGTH * 2] if value else None


def primary_pairs() -> tuple[str, ...]:
    """Every "key=value" pair that can make an element a candidate for some
    category: what the data pipeline has to keep."""
    return tuple(sorted({p.pair for c in CATEGORIES for p in c.primary}))


def tag_keys() -> tuple[str, ...]:
    """Every tag the classification and the interface read: what the data
    pipeline has to store next to the primary pair."""
    keys = {"name", "opening_hours", *ATTRIBUTE_KEYS}
    for category in CATEGORIES:
        keys |= category.rule.keys
        for primary in category.primary:
            keys.add(primary.key)
            keys |= {k for k, _ in primary.where}
    return tuple(sorted(keys))


def resolve(category_ids: list[str]) -> list[Category]:
    """Look up categories by id, raising on anything unknown."""
    unknown = [c for c in category_ids if c not in CATEGORIES_BY_ID]
    if unknown:
        raise ValueError(f"unknown categories: {', '.join(unknown)}")
    return [CATEGORIES_BY_ID[c] for c in category_ids]


def taxonomy_dict() -> dict:
    """The tree as the frontend and the data pipeline read it (taxonomy.json)."""
    return {
        "groups": [
            {
                "id": group.id,
                "categories": [
                    {
                        "id": c.id,
                        "default": c.default,
                        "primary": [
                            {"key": p.key, "value": p.value, **({"where": dict(p.where)} if p.where else {})}
                            for p in c.primary
                        ],
                        "rule": c.rule.description,
                        "priority": c.priority,
                    }
                    for c in group.categories
                ],
            }
            for group in GROUPS
        ],
        "primary_pairs": list(primary_pairs()),
        "tag_keys": list(tag_keys()),
        "attribute_keys": list(ATTRIBUTE_KEYS),
    }


if __name__ == "__main__":
    # Regenerates the tree the frontend reads:
    #   python -m randoo.categories > ../frontend/src/lib/taxonomy.json
    import json

    print(json.dumps(taxonomy_dict(), indent=2, ensure_ascii=False))
