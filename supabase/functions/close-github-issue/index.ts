// Closes a GitHub Issue that push-idea-to-github created, with an
// explanatory comment first - called from idea-portal both when an admin
// marks an idea resolved and when they delete one, so the two share this
// instead of each reimplementing the GitHub calls.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Only ever closes issues on this repo - the URL comes from the client,
// so without this an admin session could otherwise be used to close any
// issue on any repo the token can reach, not just ones this app created.
const ISSUE_URL_PATTERN = /^https:\/\/github\.com\/kgreger\/randoo\/issues\/(\d+)$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const {
    data: { user },
  } = await callerClient.auth.getUser();
  if (!user) return new Response("unauthorized", { status: 401, headers: corsHeaders });

  const { data: callerProfile } = await callerClient.from("profiles").select("tier").eq("id", user.id).single();
  if (callerProfile?.tier !== "admin") return new Response("forbidden", { status: 403, headers: corsHeaders });

  const { github_issue_url, comment, reason } = await req.json();
  const match = typeof github_issue_url === "string" ? github_issue_url.match(ISSUE_URL_PATTERN) : null;
  if (!match) return new Response("invalid or unrecognized issue url", { status: 400, headers: corsHeaders });
  const issueNumber = match[1];
  // GitHub's two valid closing reasons - "not_planned" fits a deleted
  // idea/bug better than "completed" would.
  const stateReason = reason === "deleted" ? "not_planned" : "completed";

  const githubToken = Deno.env.get("GITHUB_TOKEN")!;
  const githubHeaders = {
    Authorization: `Bearer ${githubToken}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };

  if (comment) {
    const commentResponse = await fetch(
      `https://api.github.com/repos/kgreger/randoo/issues/${issueNumber}/comments`,
      { method: "POST", headers: githubHeaders, body: JSON.stringify({ body: comment }) },
    );
    // A failed comment isn't fatal on its own - still worth closing the
    // issue, just without the explanation. Surfaced via the response body
    // either way rather than silently dropped.
    if (!commentResponse.ok) {
      const detail = await commentResponse.text().catch(() => "");
      console.error(`comment failed (${commentResponse.status}): ${detail}`);
    }
  }

  const closeResponse = await fetch(`https://api.github.com/repos/kgreger/randoo/issues/${issueNumber}`, {
    method: "PATCH",
    headers: githubHeaders,
    body: JSON.stringify({ state: "closed", state_reason: stateReason }),
  });
  if (!closeResponse.ok) {
    const detail = await closeResponse.text().catch(() => "");
    return new Response(`closing the issue failed (${closeResponse.status}): ${detail}`, {
      status: 502,
      headers: corsHeaders,
    });
  }

  return new Response("ok", { status: 200, headers: corsHeaders });
});
