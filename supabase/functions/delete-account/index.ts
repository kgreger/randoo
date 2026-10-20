// Deletes the signed-in caller's own account. The foreign keys in
// schema.sql remove the profile, saved routes, presets and upvotes; ideas
// and the export log keep their rows with the author cleared. Before that,
// everything personal that could stay behind on an idea is dealt with here:
// uploaded files are removed and the account's email address and display
// name are blanked out of the idea texts. Accounts with the admin tier are
// refused.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BUCKET = "idea-attachments";
const REDACTED = "[entfernt]";

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Whole-word, case-insensitive matches only, so a short name doesn't blank
// out the middle of unrelated words.
function redactor(terms: string[]) {
  const patterns = terms.map(
    (t) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(t)}(?![\\p{L}\\p{N}])`, "giu"),
  );
  return (text: string) => patterns.reduce((acc, p) => acc.replace(p, REDACTED), text);
}

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
  const fail = (what: string, message: string) =>
    new Response(`${what} failed: ${message}`, { status: 500, headers: corsHeaders });

  // Admins can't be deleted from here: losing the last one would lock
  // everyone out of moderation.
  const { data: profile, error: profileError } = await adminClient
    .from("profiles")
    .select("tier")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError) return fail("profile lookup", profileError.message);
  if (profile?.tier === "admin") {
    return new Response("admin accounts can't be deleted", { status: 403, headers: corsHeaders });
  }

  // Done before the account itself goes, so a failure here leaves the
  // account in place and the request can simply be repeated.
  const { data: ideas, error: ideasError } = await adminClient
    .from("ideas")
    .select("id, title, description, attachment_path")
    .eq("author_id", user.id);
  if (ideasError) return fail("idea lookup", ideasError.message);

  const { data: files, error: listError } = await adminClient.storage.from(BUCKET).list(user.id, { limit: 1000 });
  if (listError) return fail("file lookup", listError.message);
  const paths = new Set<string>((files ?? []).map((f) => `${user.id}/${f.name}`));
  for (const idea of ideas ?? []) if (idea.attachment_path) paths.add(idea.attachment_path);
  if (paths.size > 0) {
    const { error: removeError } = await adminClient.storage.from(BUCKET).remove([...paths]);
    if (removeError) return fail("file removal", removeError.message);
  }

  const displayName = user.user_metadata?.display_name;
  const terms = [user.email, typeof displayName === "string" ? displayName : ""]
    .map((t) => t.trim())
    .filter((t) => t.length >= 3);
  const redact = redactor(terms);
  for (const idea of ideas ?? []) {
    const { error: updateError } = await adminClient
      .from("ideas")
      .update({ title: redact(idea.title), description: redact(idea.description), attachment_path: null })
      .eq("id", idea.id);
    if (updateError) return fail("idea update", updateError.message);
  }

  const { error } = await adminClient.auth.admin.deleteUser(user.id);
  if (error) return fail("delete", error.message);

  return new Response("ok", { status: 200, headers: corsHeaders });
});
