// Keep in sync with backend/randoo/categories.py — no shared schema yet for the MVP.
export interface CategoryDef {
  id: string;
  label: string;
}

export const CATEGORIES: CategoryDef[] = [
  { id: "water", label: "Drinking water" },
  { id: "fuel", label: "Fuel station" },
  { id: "bike_shop", label: "Bike shop / repair" },
  { id: "lodging", label: "Lodging" },
  { id: "hut", label: "Hut / shelter" },
  { id: "food", label: "Food & supplies" },
  { id: "rest", label: "Rest spot" },
];
