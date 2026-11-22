import {
  Apple,
  Banknote,
  Bike,
  BedDouble,
  BedSingle,
  Beef,
  Bus,
  Coffee,
  Croissant,
  Cross,
  Droplet,
  Droplets,
  Flag,
  Fuel,
  Hamburger,
  Hotel,
  House,
  IceCreamCone,
  MapPinCheck,
  Mountain,
  Pill,
  Sandwich,
  ShoppingCart,
  ShowerHead,
  Sprout,
  Store,
  Tent,
  Toilet,
  TrainFront,
  TreePine,
  Umbrella,
  Utensils,
  Warehouse,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import taxonomy from "./taxonomy.json";

// The category tree - six groups with a few kinds of place each - comes from
// taxonomy.json, which is generated from backend/randoo/categories.py (a
// backend test fails when the two differ), so the ids and the defaults cannot
// drift. Only what is about looks lives here: an icon per group and per kind
// of place. `id` doubles as the i18n key, "categories.<id>" for a kind of
// place and "categoryGroups.<id>" for a group (see locales/*.json) - look the
// label up with t() rather than reading it here.
export interface CategoryDef {
  id: string;
  icon: LucideIcon;
}

export interface LeafDef extends CategoryDef {
  groupId: string;
  /** Selected for a rider who has not chosen their own default. */
  default: boolean;
  /** Whether being open matters here, so a missing opening hours is worth a note. */
  hours: boolean;
}

export interface GroupDef extends CategoryDef {
  categories: LeafDef[];
}

const GROUP_ICONS: Record<string, LucideIcon> = {
  water: Droplet,
  food: Utensils,
  shops: ShoppingCart,
  bike: Bike,
  lodging: BedDouble,
  rest: Umbrella,
};

const LEAF_ICONS: Record<string, LucideIcon> = {
  water_tap: Droplet,
  fountain: Droplets,
  spring: Sprout,
  cemetery_tap: Cross,
  restaurant: Utensils,
  fast_food: Hamburger,
  snack_bar: Sandwich,
  cafe: Coffee,
  ice_cream: IceCreamCone,
  bakery: Croissant,
  butcher: Beef,
  supermarket: ShoppingCart,
  kiosk: Store,
  grocery: Apple,
  fuel_station: Fuel,
  bike_shop: Bike,
  bike_repair: Wrench,
  hotel: Hotel,
  guest_house: House,
  hostel: BedSingle,
  camp_site: Tent,
  hut_staffed: Mountain,
  shelter: Umbrella,
  hut_open: Warehouse,
  bus_stop: Bus,
  train_station: TrainFront,
  picnic: TreePine,
  toilet: Toilet,
  shower: ShowerHead,
  pharmacy: Pill,
  atm: Banknote,
};

export const GROUPS: GroupDef[] = taxonomy.groups.map((group) => ({
  id: group.id,
  icon: GROUP_ICONS[group.id] ?? Flag,
  categories: group.categories.map((category) => ({
    id: category.id,
    icon: LEAF_ICONS[category.id] ?? GROUP_ICONS[group.id] ?? Flag,
    groupId: group.id,
    default: category.default,
    hours: category.hours,
  })),
}));

/** Every kind of place, in the order the tree lists them. */
export const CATEGORIES: LeafDef[] = GROUPS.flatMap((group) => group.categories);

export const DEFAULT_CATEGORY_IDS: string[] = CATEGORIES.filter((category) => category.default).map((c) => c.id);

export function categoryById(id: string): LeafDef | undefined {
  return CATEGORIES.find((c) => c.id === id);
}

/** The ids that are a kind of place today, in tree order; anything else (an id
 * an older version or a stale save left behind) is dropped. */
export function knownCategoryIds(ids: Iterable<string>): string[] {
  const wanted = new Set(ids);
  return CATEGORIES.filter((c) => wanted.has(c.id)).map((c) => c.id);
}

export type GroupState = "none" | "some" | "all";

/** How much of a group is selected, for its tri-state checkbox. */
export function groupState(group: GroupDef, selected: ReadonlySet<string>): GroupState {
  const count = group.categories.filter((c) => selected.has(c.id)).length;
  if (count === 0) return "none";
  return count === group.categories.length ? "all" : "some";
}

/** The selection after a click on a group's checkbox: everything in the group
 * when it was not fully selected, nothing of it when it was. */
export function toggleGroupSelection(group: GroupDef, selected: ReadonlySet<string>): Set<string> {
  const next = new Set(selected);
  const select = groupState(group, selected) !== "all";
  for (const category of group.categories) {
    if (select) next.add(category.id);
    else next.delete(category.id);
  }
  return next;
}

// What a point can be besides a search category. "waypoint" is what a point
// from the loaded file is to begin with; a rider can class points as one of
// the ASSIGNABLE_TYPES by hand (labels under "categories.<id>" like the
// search categories). Keep the assignable ids in sync with WAYPOINT_TYPES in
// backend/randoo/export.py.
export const WAYPOINT_TYPE: CategoryDef = { id: "waypoint", icon: Flag };
export const ASSIGNABLE_TYPES: CategoryDef[] = [{ id: "control", icon: MapPinCheck }];

/** A search category or one of the extra types, by id. */
export function pointTypeById(id: string): CategoryDef | undefined {
  return categoryById(id) ?? ASSIGNABLE_TYPES.find((type) => type.id === id) ?? (id === WAYPOINT_TYPE.id ? WAYPOINT_TYPE : undefined);
}
