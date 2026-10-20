// Tells every admin when a new account's email address has been confirmed.
// Called by the notify_user_registered database trigger (see schema.sql),
// not from the browser, so there is no user JWT to check: deploy with
// --no-verify-jwt and authenticate the call by the shared secret instead.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { FROM_NAME, groupByLanguage, userRegistered } from "../_shared/mail.ts";

function constantTimeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  let diff = aBytes.length ^ bBytes.length;
  for (let i = 0; i < Math.max(aBytes.length, bBytes.length); i++) {
    diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  }
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  const expectedSecret = Deno.env.get("REGISTRATION_WEBHOOK_SECRET");
  const providedSecret = req.headers.get("x-webhook-secret") ?? "";
  if (!expectedSecret || !constantTimeEqual(providedSecret, expectedSecret)) {
    return new Response("unauthorized", { status: 401 });
  }

  const { email, display_name } = await req.json();
  if (!email) return new Response("email required", { status: 400 });

  const adminClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: admins, error: adminsError } = await adminClient.from("profiles").select("id, email").eq("tier", "admin");
  if (adminsError) return new Response(`admin lookup failed: ${adminsError.message}`, { status: 500 });

  const gmailUser = Deno.env.get("GMAIL_USER")!;
  const people = (admins ?? [])
    .filter((a): a is { id: string; email: string } => !!a.email)
    .map((a) => ({ id: a.id, email: a.email }));
  const groups = await groupByLanguage(adminClient, people);
  if (people.length === 0) groups.en.push(gmailUser);

  const smtp = new SMTPClient({
    connection: {
      hostname: "smtp.gmail.com",
      port: 465,
      tls: true,
      auth: { username: gmailUser, password: Deno.env.get("GMAIL_APP_PASSWORD")! },
    },
  });

  for (const lang of ["en", "de"] as const) {
    if (groups[lang].length === 0) continue;
    const mail = userRegistered(lang, email, display_name ?? null);
    await smtp.send({
      from: `${FROM_NAME} <${gmailUser}>`,
      to: groups[lang],
      subject: mail.subject,
      content: mail.text,
      html: mail.html,
    });
  }

  await smtp.close();

  return new Response("ok", { status: 200 });
});
