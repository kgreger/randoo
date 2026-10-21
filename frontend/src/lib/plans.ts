import type { Poi } from "./api";
import { supabase } from "./supabase";

export interface PlanSummary {
  id: string;
  name: string;
  category_ids: string[];
  radius_m: number;
  poi_count: number;
  updated_at: string;
  route: { id: string; name: string; distance_m: number | null };
}

export interface LoadedPlan {
  id: string;
  name: string;
  category_ids: string[];
  radius_m: number;
  pois: Poi[];
  excluded_poi_ids: string[];
  route: { id: string; name: string; gpx: string };
}

export interface PlanInput {
  name: string;
  categoryIds: string[];
  radiusM: number;
  pois: Poi[];
  excludedPoiIds: string[];
}

function client() {
  if (!supabase) throw new Error("Supabase is not configured");
  return supabase;
}

export async function listPlans(): Promise<PlanSummary[]> {
  const { data, error } = await client()
    .from("plans")
    .select("id, name, category_ids, radius_m, poi_count, updated_at, routes(id, name, distance_m)")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => {
    // PostgREST types a to-one embed as an array or an object depending on
    // the generated types; at runtime it is the single related row.
    const route = (Array.isArray(row.routes) ? row.routes[0] : row.routes) as PlanSummary["route"];
    return { ...row, route } as PlanSummary;
  });
}

export async function loadPlan(id: string): Promise<LoadedPlan> {
  const { data, error } = await client()
    .from("plans")
    .select("id, name, category_ids, radius_m, pois, excluded_poi_ids, routes(id, name, gpx)")
    .eq("id", id)
    .single();
  if (error) throw error;
  const route = (Array.isArray(data.routes) ? data.routes[0] : data.routes) as LoadedPlan["route"];
  return { ...data, route } as LoadedPlan;
}

export interface SavedRef {
  routeId: string;
  planId: string;
}

// Adds a plan to an already saved route, or saves the route first when this
// is its first plan.
export async function createPlan(
  input: PlanInput,
  route: { id: string | null; name: string; gpx: string; distanceM: number | null },
): Promise<SavedRef> {
  const db = client();
  const { data: userData } = await db.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) throw new Error("Not signed in");

  let routeId = route.id;
  if (!routeId) {
    const { data, error } = await db
      .from("routes")
      .insert({ user_id: userId, name: route.name, gpx: route.gpx, distance_m: route.distanceM })
      .select("id")
      .single();
    if (error) throw error;
    routeId = data.id as string;
  }

  const { data, error } = await db
    .from("plans")
    .insert({
      user_id: userId,
      route_id: routeId,
      name: input.name,
      category_ids: input.categoryIds,
      radius_m: input.radiusM,
      pois: input.pois,
      poi_count: input.pois.length,
      excluded_poi_ids: input.excludedPoiIds,
    })
    .select("id")
    .single();
  if (error) throw error;
  return { routeId, planId: data.id as string };
}

export async function updatePlan(id: string, input: PlanInput): Promise<void> {
  const { error } = await client()
    .from("plans")
    .update({
      name: input.name,
      category_ids: input.categoryIds,
      radius_m: input.radiusM,
      pois: input.pois,
      poi_count: input.pois.length,
      excluded_poi_ids: input.excludedPoiIds,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw error;
}

// Removes the plan, and the route with it once no plan is left on it.
// Resolves to true when the route went too.
export async function deletePlan(plan: PlanSummary): Promise<boolean> {
  const db = client();
  const { error } = await db.from("plans").delete().eq("id", plan.id);
  if (error) throw error;
  const { count } = await db.from("plans").select("id", { count: "exact", head: true }).eq("route_id", plan.route.id);
  if (count === 0) {
    await db.from("routes").delete().eq("id", plan.route.id);
    return true;
  }
  return false;
}
