// Deletes the signed-in caller's own account. Everything that hangs off it
// follows from the foreign keys in schema.sql: the profile, saved routes,
// presets and upvotes are removed, while ideas and the export log keep
// their rows with the author cleared.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const callerClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const {
    data: { user },
  } = await callerClient.auth.getUser();
  if (!user) return new Response("unauthorized", { status: 401, headers: corsHeaders });

  const body = await req.json().catch(() => ({}));
  const confirmed = typeof body.confirm_email === "string" ? body.confirm_email.trim().toLowerCase() : "";
  if (!user.email || confirmed !== user.email.toLowerCase()) {
    return new Response("confirmation does not match", { status: 400, headers: corsHeaders });
  }

  const adminClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { error } = await adminClient.auth.admin.deleteUser(user.id);
  if (error) return new Response(`delete failed: ${error.message}`, { status: 500, headers: corsHeaders });

  return new Response("ok", { status: 200, headers: corsHeaders });
});
