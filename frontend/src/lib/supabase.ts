import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Login is optional for the MVP — the app has to work fully without it, so
// we don't throw when these are missing, just skip auth entirely.
export const supabase = url && anonKey ? createClient(url, anonKey) : null;
