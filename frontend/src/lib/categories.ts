import { Armchair, Bike, Droplet, Fuel, ShoppingBasket, Tent, BedDouble, type LucideIcon } from "lucide-react";

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
