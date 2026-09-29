// Creates a GitHub Issue on the randoo repo from an idea/bug, admin-
// triggered only - randoo is a public repo, so auto-pushing every raw
// submission the moment it's filed would make half-baked or sensitive
// entries instantly public. Idempotent: an idea that already has
// github_issue_url set just returns that link again instead of filing a
// second issue.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// idea-portal calls this cross-origin, see notify-idea-status for the
// CORS gotcha this avoids.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GITHUB_REPO = "kgreger/randoo";

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Scoped to the caller's own JWT so the admin check below actually means
  // something - anyone could otherwise hit this function's URL directly
  // and file issues against the repo at will.
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const {
    data: { user },
  } = await callerClient.auth.getUser();
  if (!user) return new Response("unauthorized", { status: 401, headers: corsHeaders });

  const { data: callerProfile } = await callerClient.from("profiles").select("tier").eq("id", user.id).single();
  if (callerProfile?.tier !== "admin") return new Response("forbidden", { status: 403, headers: corsHeaders });

  const { idea_id } = await req.json();
  if (!idea_id) return new Response("idea_id required", { status: 400, headers: corsHeaders });

  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: idea, error: ideaError } = await adminClient
    .from("ideas")
    .select("title, description, kind, github_issue_url")
    .eq("id", idea_id)
    .single();
  if (ideaError) return new Response(`idea lookup failed: ${ideaError.message}`, { status: 500, headers: corsHeaders });
  if (!idea) return new Response("idea not found", { status: 404, headers: corsHeaders });
  if (idea.github_issue_url) return jsonResponse({ url: idea.github_issue_url }, 200);

  // Claims the row before calling GitHub at all: two requests racing each
  // other (e.g. an impatient double-click before the button had a chance
  // to disable) would otherwise both read github_issue_url as still null
  // above and both go on to file an issue. The `is(..., null)` condition
  // makes this UPDATE atomic - only the request that actually flips it
  // from null wins, a concurrent second one gets 0 rows back.
  const { data: claimed, error: claimError } = await adminClient
    .from("ideas")
    .update({ github_issue_url: "pending" })
    .eq("id", idea_id)
    .is("github_issue_url", null)
    .select("id")
    .maybeSingle();
  if (claimError) return new Response(`claim failed: ${claimError.message}`, { status: 500, headers: corsHeaders });
  if (!claimed) {
    const { data: current } = await adminClient.from("ideas").select("github_issue_url").eq("id", idea_id).single();
    if (current?.github_issue_url && current.github_issue_url !== "pending") {
      return jsonResponse({ url: current.github_issue_url }, 200);
    }
    return new Response("a push for this idea is already in progress", { status: 409, headers: corsHeaders });
  }

  // Standard GitHub default labels - if this repo's labels were ever
  // renamed or removed, GitHub rejects the whole request rather than
  // silently dropping them, and the admin sees exactly that in the error
  // banner (see idea-portal's functionErrorDetail).
  const label = idea.kind === "bug" ? "bug" : "enhancement";

  const ghResponse = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/issues`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("GITHUB_TOKEN")!}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ title: idea.title, body: idea.description, labels: [label] }),
  });

  if (!ghResponse.ok) {
    // Release the claim - otherwise this row is stuck on "pending"
    // forever, since nothing else ever clears it back to null.
    await adminClient.from("ideas").update({ github_issue_url: null }).eq("id", idea_id);
    const detail = await ghResponse.text().catch(() => "");
    return new Response(`GitHub issue creation failed (${ghResponse.status}): ${detail}`, {
      status: 502,
      headers: corsHeaders,
    });
  }

  const issue = await ghResponse.json();
  const issueUrl = issue.html_url as string;

  const { error: updateError } = await adminClient
    .from("ideas")
    .update({ github_issue_url: issueUrl })
    .eq("id", idea_id);
  // The issue exists on GitHub either way at this point - surfacing the
  // failure rather than silently losing the link means the admin knows to
  // either retry (creates a duplicate issue) or set the URL by hand.
  if (updateError) {
    return new Response(`issue created (${issueUrl}) but failed to save the link: ${updateError.message}`, {
      status: 500,
      headers: corsHeaders,
    });
  }

  return jsonResponse({ url: issueUrl }, 200);
});
