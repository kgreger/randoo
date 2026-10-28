import type { Poi } from "./api";
import { ASSIGNABLE_TYPES, CATEGORIES, WAYPOINT_TYPE } from "./categories";
import type { RouteWaypoint } from "./gpxPreview";

/** The type a found point shows as: the one the rider gave it, else its category. */
export function poiTypeId(poi: Poi, typeOverrides: Record<string, string>): string {
  return typeOverrides[poi.id] ?? poi.category_id;
}

/** The type a file waypoint shows as: the one the rider gave it, else its fixed
 * type (the route's start and end), else a plain waypoint. */
export function waypointTypeId(waypoint: RouteWaypoint, typeOverrides: Record<string, string>): string {
  return typeOverrides[waypoint.id] ?? waypoint.fixedType ?? WAYPOINT_TYPE.id;
}

const TYPE_ORDER = [...CATEGORIES, ...ASSIGNABLE_TYPES, WAYPOINT_TYPE].map((type) => type.id);

/** The types among the given ids with how many points have each, in the order
 * the types are listed everywhere else. */
export function countTypes(typeIds: string[]): { typeId: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const typeId of typeIds) counts.set(typeId, (counts.get(typeId) ?? 0) + 1);
  const rank = (typeId: string) => {
    const index = TYPE_ORDER.indexOf(typeId);
    return index === -1 ? TYPE_ORDER.length : index;
  };
  return [...counts]
    .map(([typeId, count]) => ({ typeId, count }))
    .sort((a, b) => rank(a.typeId) - rank(b.typeId));
}
