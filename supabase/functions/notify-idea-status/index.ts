// Notifies an idea's author and everyone who upvoted it once an admin
// marks it resolved (bug fixed / idea accepted). Called directly from
// idea-portal's admin toggle, not via a database webhook - the admin
// client already holds the session, and there's exactly one place in the
// app that flips status, so a trigger would just add moving parts.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

// idea-portal calls this cross-origin (a different host than this function
// lives on), so every response - including the preflight and every early
// return below - needs these, or the browser never even lets the caller
// see the response, let alone the actual mail go out.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Scoped to the caller's own JWT so the admin check below actually
  // means something - anyone could otherwise hit this function's URL
  // directly and trigger a mail blast for an arbitrary idea.
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

  // Service role from here on: gathering every voter's email crosses
  // between users' own rows, which RLS deliberately blocks for anyone
  // but this trusted server-side context.
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: idea, error: ideaError } = await adminClient
    .from("ideas")
    .select("title, kind, author_id")
    .eq("id", idea_id)
    .single();
  // A real query error (bad service role key, connection issue, ...) was
  // silently indistinguishable from a genuinely missing row here before -
  // both just left `idea` falsy, so a caller only ever saw "idea not
  // found" either way, masking the actual problem.
  if (ideaError) return new Response(`idea lookup failed: ${ideaError.message}`, { status: 500, headers: corsHeaders });
  if (!idea) return new Response("idea not found", { status: 404, headers: corsHeaders });

  const { data: votes } = await adminClient.from("idea_votes").select("user_id").eq("idea_id", idea_id);
  const recipientIds = new Set<string>((votes ?? []).map((v) => v.user_id as string));
  if (idea.author_id) recipientIds.add(idea.author_id);
  if (recipientIds.size === 0) return new Response("no recipients", { status: 200, headers: corsHeaders });

  const { data: profiles } = await adminClient
    .from("profiles")
    .select("email")
    .in("id", Array.from(recipientIds));
  const emails = (profiles ?? []).map((p) => p.email).filter((e): e is string => !!e);
  if (emails.length === 0) return new Response("no email addresses on file", { status: 200, headers: corsHeaders });

  const gmailUser = Deno.env.get("GMAIL_USER")!;
  const resolvedLabel = idea.kind === "bug" ? "fixed" : "accepted";

  const smtp = new SMTPClient({
    connection: {
      hostname: "smtp.gmail.com",
      port: 465,
      tls: true,
      auth: { username: gmailUser, password: Deno.env.get("GMAIL_APP_PASSWORD")! },
    },
  });

  // One send, everyone in bcc - fewer SMTP round trips than looping,
  // and nobody sees the rest of the recipient list.
  await smtp.send({
    from: gmailUser,
    to: gmailUser,
    bcc: emails,
    subject: `Your ${idea.kind} "${idea.title}" was marked ${resolvedLabel}`,
    content: `Hi,\n\nThe ${idea.kind} "${idea.title}" you submitted or upvoted on Randoo's idea board has just been marked as ${resolvedLabel}.\n\nThanks for the feedback.`,
  });
  await smtp.close();

  return new Response("ok", { status: 200, headers: corsHeaders });
});
