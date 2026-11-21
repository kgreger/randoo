import type { Poi } from "./api";

export type PoiBadge = "shop" | "fee" | "unchecked" | "seasonal";

/** The short notes shown next to a point, from the few tags the backend sends
 * along (see ATTRIBUTE_KEYS in backend/randoo/categories.py). Labels live under
 * "badges.<kind>" in the locales. */
export function poiBadges(poi: Pick<Poi, "category_id" | "attributes">): PoiBadge[] {
  const attributes = poi.attributes ?? {};
  const badges: PoiBadge[] = [];
  // A fuel station that is only pumps, or one with a shop for snacks and drinks.
  if (poi.category_id === "fuel_station" && attributes.shop && attributes.shop !== "no") badges.push("shop");
  if (attributes.fee === "yes") badges.push("fee");
  // A spring nobody has said is safe to drink from.
  if (poi.category_id === "spring" && attributes.drinking_water !== "yes") badges.push("unchecked");
  if (attributes.seasonal && attributes.seasonal !== "no") badges.push("seasonal");
  return badges;
}
