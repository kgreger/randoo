import { Armchair, Bike, Droplet, Fuel, ShoppingBasket, Tent, BedDouble, type LucideIcon } from "lucide-react";

// Keep in sync with backend/randoo/categories.py; no shared schema yet for the MVP.
export interface CategoryDef {
  id: string;
  label: string;
  icon: LucideIcon;
}

export const CATEGORIES: CategoryDef[] = [
  { id: "water", label: "Drinking water", icon: Droplet },
  { id: "fuel", label: "Fuel station", icon: Fuel },
  { id: "bike_shop", label: "Bike shop / repair", icon: Bike },
  { id: "lodging", label: "Lodging", icon: BedDouble },
  { id: "hut", label: "Hut / shelter", icon: Tent },
  { id: "food", label: "Food & supplies", icon: ShoppingBasket },
  { id: "rest", label: "Rest spot", icon: Armchair },
];

export function categoryById(id: string): CategoryDef | undefined {
  return CATEGORIES.find((c) => c.id === id);
}
