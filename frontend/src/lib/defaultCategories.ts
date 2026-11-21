import { DEFAULT_CATEGORY_IDS, knownCategoryIds } from "./categories";

// The kinds of place a rider starts every search with, saved on the account
// (user_metadata.default_categories); without an account, or before one is
// saved, Randoo's own default applies. Ids that are no kind of place any more
// are dropped, and an empty list counts as unset.
export function defaultCategoriesFromUser(metadata: Record<string, unknown> | undefined): string[] {
  const saved = metadata?.default_categories;
  if (Array.isArray(saved)) {
    const known = knownCategoryIds(saved.filter((id): id is string => typeof id === "string"));
    if (known.length > 0) return known;
  }
  return DEFAULT_CATEGORY_IDS;
}

export function hasSavedDefaultCategories(metadata: Record<string, unknown> | undefined): boolean {
  const saved = metadata?.default_categories;
  return Array.isArray(saved) && saved.length > 0;
}
