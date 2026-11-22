# POI categories

Randoo sorts OpenStreetMap objects into a tree of 6 groups and 31 categories (the leaves). This document describes the tree, how an object is classified, how the data flows from OSM to the app, the Garmin mapping, and what is deliberately left open.

The code is authoritative, not this document:

- `backend/randoo/categories.py`: taxonomy, rules, `classify()`
- `backend/randoo/poi_rules.py`: the small rule DSL the rules are written in
- `frontend/src/lib/taxonomy.json`: generated from `categories.py`, read by the frontend

## Tree

| Group | Categories |
| --- | --- |
| Drinking water (`water`) | `water_tap`, `fountain`, `spring`, `cemetery_tap` |
| Food & drink (`food`) | `restaurant`, `fast_food`, `snack_bar`, `cafe`, `ice_cream`, `bakery`, `butcher` |
| Shopping (`shops`) | `supermarket`, `kiosk`, `grocery`, `fuel_station` |
| Bike (`bike`) | `bike_shop`, `bike_repair` |
| Sleeping (`lodging`) | `hotel`, `guest_house`, `hostel`, `camp_site`, `hut_staffed` |
| Shelter, rest & services (`rest`) | `shelter`, `hut_open`, `bus_stop`, `train_station`, `picnic`, `toilet`, `shower`, `pharmacy`, `atm` |

Display names are in `frontend/src/i18n/locales/{de,en}.json` under `categories.*` and `categoryGroups.*`.

### Categories and OSM tags

"Primary tags" are the key/value pairs that make an object a candidate (they drive the Overpass query and the `primary_tags` Parquet column). A condition in square brackets narrows a pair. "Rule" is what a candidate must additionally satisfy. `priority` decides between categories (lowest wins, see below).

| Category | Primary tags | Rule (short) | Priority |
| --- | --- | --- | --- |
| `water_tap` | `amenity=drinking_water`; `man_made=water_tap` and `amenity=water_point`, each with `drinking_water=yes` | not `drinking_water=no/none/legal:no`, not `access=private/no` | 50 |
| `fountain` | `amenity=fountain` and `man_made=water_well`, each with `drinking_water=yes`; `man_made=drinking_fountain` | as `water_tap` | 50 |
| `spring` | `natural=spring` | not `drinking_water=no/none/legal:no` | 50 |
| `cemetery_tap` | as `water_tap` | as `water_tap`, and (`in_cemetery=yes` or friedhof/cemetery/kerkhof/begraafplaats in `name`, `operator`, `description` or `note`) | 10 |
| `restaurant` | `amenity=restaurant`, `pub`, `biergarten` | not `access=private/no` | 50 |
| `fast_food` | `amenity=fast_food` | not a canteen and not `snack_bar` (below) | 50 |
| `snack_bar` | `amenity=fast_food` | see "Fast food and snack bar" | 50 |
| `cafe` | `amenity=cafe` | always | 50 |
| `ice_cream` | `amenity=ice_cream`, `shop=ice_cream` | always | 50 |
| `bakery` | `shop=bakery` | always | 45 |
| `butcher` | `shop=butcher` | always | 45 |
| `supermarket` | `shop=supermarket` | always | 50 |
| `kiosk` | `shop=kiosk`, `shop=convenience` | always | 60 |
| `grocery` | `shop=greengrocer`, `shop=farm`, `shop=general` | always | 60 |
| `fuel_station` | `amenity=fuel` | not `access=private/no` | 40 |
| `bike_shop` | `shop=bicycle` | always | 50 |
| `bike_repair` | `amenity=bicycle_repair_station` | not `access=private/no` | 50 |
| `hotel` | `tourism=hotel`, `motel` | always | 30 |
| `guest_house` | `tourism=guest_house`, `apartment`, `chalet` | always | 30 |
| `hostel` | `tourism=hostel` | always | 30 |
| `camp_site` | `tourism=camp_site` | always | 30 |
| `hut_staffed` | `tourism=alpine_hut` | staffed (below) | 10 |
| `shelter` | `amenity=shelter` | not `access=private/no`, not `shelter_type=basic_hut` | 50 |
| `hut_open` | `tourism=wilderness_hut`; `tourism=alpine_hut`; `amenity=shelter` with `shelter_type=basic_hut` | not private; `wilderness_hut` and `amenity=shelter` always, `alpine_hut` only when not staffed | 20 |
| `bus_stop` | `highway=bus_stop` with `shelter=yes` or `covered=yes`; `amenity=shelter` | `highway=bus_stop`, or `shelter_type=public_transport`, `bus=yes`, `public_transport=*` | 10 |
| `train_station` | `railway=station`, `railway=halt` | always | 50 |
| `picnic` | `leisure=picnic_table`, `tourism=picnic_site` | not `access=private/no` | 70 |
| `toilet` | `amenity=toilets` | not `access=private/no/customers/permit` | 50 |
| `shower` | `amenity=shower` | not `access=private/no` | 50 |
| `pharmacy` | `amenity=pharmacy` | always | 50 |
| `atm` | `amenity=atm` | always | 50 |

`python -m randoo.categories` (or `taxonomy.json`) prints the exact rules, including the full cuisine lists.

Benches are not a category: they are too common to list individually.

## Classification

Every OSM element is classified **once, against all categories**; only then is the result filtered to the categories the rider selected. An element therefore always gets the same single category, whatever else is selected. When several categories match, the lowest `priority` wins; ties go to the order in `CATEGORIES`.

| Priority | Categories | Why |
| --- | --- | --- |
| 10 | `hut_staffed`, `cemetery_tap`, `bus_stop` | the most specific cases first |
| 20 | `hut_open` | before lodging and `shelter` |
| 30 | lodging | |
| 40 | `fuel_station` | a station with a shop stays a fuel station |
| 45 | `bakery`, `butcher` | before `kiosk` and `grocery` |
| 50 | everything else | |
| 60 | `kiosk`, `grocery` | |
| 70 | `picnic` | weakest case |

An object is never in two categories. Whether multiple assignment would help is to be reviewed once the categories have seen real use.

### Fast food and snack bar

Both categories read `amenity=fast_food`; no element is in both.

- `IS_CHAIN`: `brand` or `brand:wikidata` is set.
- Protected cuisines: kebab, doner, döner, gyros, falafel, turkish, arab, lebanese, syrian, oriental, balkan, sausage, currywurst, german, regional, bavarian.
- `FAST_FOOD_BY_BRAND` = `IS_CHAIN` and no protected cuisine. A branded outlet is fast food even when its cuisine is `pizza` or `chicken` (McDonald's, Burger King, KFC, Domino's and so on). A branded döner chain with `cuisine=kebab` stays a snack bar.
- `snack_bar`: not a canteen, not `FAST_FOOD_BY_BRAND`, and either its cuisine is a snack-bar cuisine or it has neither cuisine nor brand. Snack-bar cuisines are the protected ones plus pizza, italian, italian_pizza, greek, asian, chinese, vietnamese, thai, indian, japanese, korean, sushi, noodle(s), ramen, fries, friture, fish, fish_and_chips, seafood, chicken, barbecue, grill, wok.
- `fast_food`: whatever is left, canteens (`cuisine=canteen`) excluded.

Before the tree, `amenity=fast_food` was in no category, which is why such outlets were missing.

### Staffed alpine hut

A `tourism=alpine_hut` is staffed (`hut_staffed`) when it is not `self_service=yes` and at least one of these holds: it is also `amenity=restaurant/pub/cafe/biergarten`; `opening_hours`, `website`, `phone`, `contact:phone` or `contact:website` is set; `food=yes`; `drink=yes`; `reservation=yes/required/recommended`. Otherwise it is `hut_open`. `tourism=wilderness_hut` and `amenity=shelter` with `shelter_type=basic_hut` are always `hut_open`.

### Bus stops and shelters

`bus_stop` holds bus stops with a roof (`shelter=yes` or `covered=yes`) and shelters that are recognisably public transport (`shelter_type=public_transport`, `bus=yes`, `public_transport=*`). Every other `amenity=shelter` is `shelter`.

## Default selection

`fuel_station`, `bakery` and `bike_shop` are selected by default (`default` in `categories.py`). A signed-in rider can save their own default: `user_metadata.default_categories` in Supabase Auth (frontend: `lib/defaultCategories.ts`). IDs that no longer exist are dropped when it is read; an empty result counts as unset and the built-in default applies.

## Extra information on a POI

- `opening_hours` is passed through as the raw string and appended to the comment in the GPX export. For premium searches the list and the map also show it as a week chart, parsed by the weekly data build (see [opening-hours.md](opening-hours.md)). It is not evaluated ("open now") yet.
- For the kinds of place where being open matters (`HOURS_MATTER` in `categories.py`: restaurants, fast food, snack bars, cafés, ice cream, bakeries, butchers, supermarkets, kiosks, small shops, fuel stations, bike shops, pharmacies) the list shows "Opening hours unknown" when OpenStreetMap has none. About 30 to 60 percent of these places have hours mapped, so the note is common. The flag is `hours` in `taxonomy.json`.
- A whitelist of tags (`ATTRIBUTE_KEYS`: `drinking_water`, `fee`, `shop`, `access`, `seasonal`) is returned as `PoiOut.attributes`. The frontend shows short badges from them (`lib/poiBadges.ts`):
  - `shop`: a fuel station with a shop (`shop` set and not `no`)
  - `fee`: `fee=yes`
  - `unchecked`: a `spring` without `drinking_water=yes`
  - `seasonal`: `seasonal` set and not `no`

## Data flow

1. **Overpass (free tier).** `overpass.py::_build_query` builds the query from the primary pairs of the selected categories, including their `where` conditions. `_parse_elements` classifies every returned element globally, then filters to the selection.
2. **Local data (premium tier).** The pipeline in `randoo-infra` no longer writes a category. It writes, per object, the list of primary pairs it satisfies (`primary_tags VARCHAR[]`) and the full tags (`tags`). `LocalPoiSource` selects by `primary_tags` and classifies at read time with the same `classify()`. It still reads files in the old format (`category_id` column) until the pipeline has rebuilt `pois.parquet`.
3. **Frontend.** The tree is built from `taxonomy.json`: a group checkbox with three states and the categories below it.

The category is therefore a read-time property: changing a rule does not require rebuilding the data as long as the primary pairs stay the same.

### Changing the taxonomy

1. Edit the rules in `categories.py` and add cases to `backend/tests/test_categories.py`.
2. Regenerate the frontend copy: `cd backend && PYTHONPATH=. python -m randoo.categories > ../frontend/src/lib/taxonomy.json`. A test fails when it is out of date.
3. Add display names to `de.json` and `en.json` (a test checks both).
4. Copy `taxonomy.json` to `randoo-infra/randoo_infra/taxonomy.json`.
5. If a primary pair changed: re-run the pipeline in `randoo-infra` and replace `pois.parquet`.

## Garmin

Garmin Connect reads only `<type>` when it imports a course (the FIT course point type, case-insensitive) and ignores `<sym>`. The mapping is in `export.py` and is derived from the taxonomy: the group is the fallback, single categories override it.

| Category | `<type>` | `<sym>` |
| --- | --- | --- |
| group `water` | `water` | Drinking Water |
| group `food` | `food` | Restaurant |
| `fast_food`, `snack_bar` | `food` | Fast Food |
| group `shops` | `store` | Shopping Center |
| `kiosk` | `store` | Convenience Store |
| `fuel_station` | `store` | Gas Station |
| group `bike` | `service` | Flag, Blue |
| group `lodging` | `shelter` | Lodging |
| `camp_site` | `campsite` | Campground |
| `shelter`, `hut_open` | `shelter` | Campground |
| group `rest` (others) | `rest_area` | Picnic Area |
| `bus_stop`, `train_station` | `transport` | Ground Transportation |
| `toilet` | `toilet` | Restroom |
| `shower` | `shower` | Shower |
| `pharmacy` | `first_aid` | Pharmacy |
| `atm` | `service` | Bank |
| control point (set by hand) | `checkpoint` | Flag, Red |

Provisional: the `<type>` assignment has not been confirmed yet, the `<sym>` names are unverified in BaseCamp, and `coffee_shop` for cafés still needs a test on an Edge 850.

## Limits

- Result quality depends on OSM: cuisine and brand are often missing. A snack outlet with neither lands in `snack_bar`; one with a brand lands in `fast_food`.
- Cemetery water is recognised by `in_cemetery=yes` and by words in name or notes. There is no geometric check against cemetery areas.
- A bus stop and its shelter can both appear; merging them (about 25 m) is not done yet.
- No plans are stored, so there is nothing to migrate. Old category IDs in a request are answered with HTTP 400.

## Not done yet

- Review multiple assignment
- Merge nearby bus stops and shelters
- A "tap (unchecked)" type for water points without `drinking_water`
- Evaluate opening hours (open now, arrival times); showing them as a week is done
- Rework of the profile and settings area

## After merging

- Run the `randoo-infra` tests and pipeline and rebuild `pois.parquet` (the opening-hours charts need the rebuilt file; without it the popovers show only the text)
- Copy `taxonomy.json` to `randoo-infra` whenever it changes
- Check the Garmin symbols and `coffee_shop` on a device
- Mention `user_metadata.default_categories` in the privacy text
