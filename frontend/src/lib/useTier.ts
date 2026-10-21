import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { useAuth } from "./useAuth";

// Mirrors public.can_save_plans() in supabase/schema.sql, which is what
// actually enforces it; this only decides what the UI offers.
const PLAN_TIERS = ["premium", "beta", "admin"];

export function useCanSavePlans(): boolean {
  const { user } = useAuth();
  const [tier, setTier] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase || !user) {
      setTier(null);
      return;
    }
    supabase
      .from("profiles")
      .select("tier")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => setTier(data?.tier ?? null));
  }, [user?.id]);

  return tier !== null && PLAN_TIERS.includes(tier);
}
