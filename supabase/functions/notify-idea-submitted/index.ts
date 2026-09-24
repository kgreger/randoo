// Notifies an idea/bug's own author (confirmation) and every admin
// (heads-up) once it's submitted. Called directly from idea-portal's
// submit flow, same reasoning as notify-idea-status: there's exactly one
// place in the app that creates an idea, so a database trigger would just
// add moving parts for no real benefit.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

// idea-portal calls this cross-origin, so every response needs these, see
// notify-idea-status for the CORS gotcha this avoids.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const {
    data: { user },
  } = await callerClient.auth.getUser();
  if (!user) return new Response("unauthorized", { status: 401, headers: corsHeaders });

  const { idea_id } = await req.json();
  if (!idea_id) return new Response("idea_id required", { status: 400, headers: corsHeaders });

  // Service role from here on: every admin's email crosses between users'
  // own rows, which RLS deliberately blocks for a non-admin submitter.
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: idea, error: ideaError } = await adminClient
    .from("ideas")
    .select("title, kind, author_id")
    .eq("id", idea_id)
    .single();
  if (ideaError) return new Response(`idea lookup failed: ${ideaError.message}`, { status: 500, headers: corsHeaders });
  if (!idea) return new Response("idea not found", { status: 404, headers: corsHeaders });

  // Only the idea's own author can trigger their own confirmation - unlike
  // notify-idea-status this isn't admin-gated, since submitting is
  // something every signed-in rider does for themselves.
  if (idea.author_id !== user.id) return new Response("forbidden", { status: 403, headers: corsHeaders });

  const { data: author, error: authorError } = await adminClient
    .from("profiles")
    .select("email")
    .eq("id", user.id)
    .single();
  if (authorError) return new Response(`author lookup failed: ${authorError.message}`, { status: 500, headers: corsHeaders });

  const { data: admins, error: adminsError } = await adminClient.from("profiles").select("email").eq("tier", "admin");
  if (adminsError) return new Response(`admin lookup failed: ${adminsError.message}`, { status: 500, headers: corsHeaders });

  const gmailUser = Deno.env.get("GMAIL_USER")!;
  const smtp = new SMTPClient({
    connection: {
      hostname: "smtp.gmail.com",
      port: 465,
      tls: true,
      auth: { username: gmailUser, password: Deno.env.get("GMAIL_APP_PASSWORD")! },
    },
  });

  if (author?.email) {
    await smtp.send({
      from: gmailUser,
      to: author.email,
      subject: `Your ${idea.kind} "${idea.title}" was received`,
      content: `Hi,\n\nThanks for submitting the ${idea.kind} "${idea.title}" to Randoo's idea board. We'll let you know once it's picked up.`,
    });
  }

  // Skip an admin who just submitted their own idea - they already got
  // the author confirmation above, a second copy would just be noise.
  const adminEmails = (admins ?? [])
    .map((a) => a.email)
    .filter((e): e is string => !!e && e !== author?.email);
  if (adminEmails.length > 0) {
    await smtp.send({
      from: gmailUser,
      to: gmailUser,
      bcc: adminEmails,
      subject: `New ${idea.kind} submitted: "${idea.title}"`,
      content: `Hi,\n\nA new ${idea.kind} "${idea.title}" was just submitted to Randoo's idea board.`,
    });
  }

  await smtp.close();

  return new Response("ok", { status: 200, headers: corsHeaders });
});
