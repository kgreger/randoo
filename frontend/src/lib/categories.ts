import { Armchair, Bike, Droplet, Fuel, Flag, MapPinCheck, ShoppingBasket, Tent, BedDouble, type LucideIcon } from "lucide-react";

// Keep in sync with backend/randoo/categories.py; no shared schema yet for
// the MVP. `id` doubles as the i18n key under "categories.<id>" (see
// locales/*.json) - look the label up with t() rather than reading it here.
export interface CategoryDef {
  id: string;
  icon: LucideIcon;
}

export const CATEGORIES: CategoryDef[] = [
  { id: "water", icon: Droplet },
  { id: "fuel", icon: Fuel },
  { id: "bike_shop", icon: Bike },
  { id: "lodging", icon: BedDouble },
  { id: "hut", icon: Tent },
  { id: "food", icon: ShoppingBasket },
  { id: "rest", icon: Armchair },
];

export function categoryById(id: string): CategoryDef | undefined {
  return CATEGORIES.find((c) => c.id === id);
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
