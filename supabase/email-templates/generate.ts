// Writes the Supabase Auth email templates (paste each file into the
// dashboard under Authentication > Emails). Run from the repo root:
//   deno run --allow-write supabase/email-templates/generate.ts
//
// Each template picks its language from the account's user_metadata
// (the app stores it at signup, see SignInDialog.tsx): German or English
// when it's set, both languages stacked when it isn't (accounts that
// predate the setting). The nested ifs matter: comparing a missing value
// with eq would make the template fail instead of falling through.
import { layoutHtml, reasonHtml, sectionsHtml, type Section } from "../functions/_shared/mail.ts";

type Template = { de: Section; en: Section; reasonDe: string; reasonEn: string };

const LINK = "{{ .ConfirmationURL }}";

const templates: Record<string, Template> = {
  "confirm-signup.html": {
    de: {
      heading: "Willkommen bei Randoo",
      paragraphs: ["Bestätige deine E-Mail-Adresse {{ .Email }}, um dein Konto zu aktivieren."],
      button: { label: "E-Mail-Adresse bestätigen", url: LINK, showUrl: true },
    },
    en: {
      heading: "Welcome to Randoo",
      paragraphs: ["Confirm your email address {{ .Email }} to activate your account."],
      button: { label: "Confirm email address", url: LINK, showUrl: true },
    },
    reasonDe:
      "Du bekommst diese Mail, weil sich jemand mit dieser Adresse bei Randoo registriert hat. Warst du das nicht, kannst du sie ignorieren.",
    reasonEn:
      "You're getting this email because someone signed up to Randoo with this address. If that wasn't you, you can ignore it.",
  },
  "magic-link.html": {
    de: {
      heading: "Dein Anmeldelink",
      paragraphs: ["Mit diesem Link meldest du dich ohne Passwort bei Randoo an. Er funktioniert nur einmal und nur kurze Zeit."],
      button: { label: "Bei Randoo anmelden", url: LINK, showUrl: true },
    },
    en: {
      heading: "Your sign-in link",
      paragraphs: ["Use this link to sign in to Randoo without a password. It works once and only for a short time."],
      button: { label: "Sign in to Randoo", url: LINK, showUrl: true },
    },
    reasonDe:
      "Du bekommst diese Mail, weil für diese Adresse ein Anmeldelink angefordert wurde. Warst du das nicht, kannst du sie ignorieren.",
    reasonEn:
      "You're getting this email because a sign-in link was requested for this address. If that wasn't you, you can ignore it.",
  },
  "recovery.html": {
    de: {
      heading: "Passwort zurücksetzen",
      paragraphs: ["Wähle ein neues Passwort für dein Randoo-Konto."],
      button: { label: "Neues Passwort wählen", url: LINK, showUrl: true },
    },
    en: {
      heading: "Reset your password",
      paragraphs: ["Choose a new password for your Randoo account."],
      button: { label: "Choose a new password", url: LINK, showUrl: true },
    },
    reasonDe:
      "Du bekommst diese Mail, weil für diese Adresse ein neues Passwort angefordert wurde. Warst du das nicht, kannst du sie ignorieren.",
    reasonEn:
      "You're getting this email because a password reset was requested for this address. If that wasn't you, you can ignore it.",
  },
  "email-change.html": {
    de: {
      heading: "Neue E-Mail-Adresse bestätigen",
      paragraphs: ["Bestätige, dass {{ .NewEmail }} künftig die Adresse deines Randoo-Kontos sein soll."],
      button: { label: "Neue Adresse bestätigen", url: LINK, showUrl: true },
    },
    en: {
      heading: "Confirm your new email address",
      paragraphs: ["Confirm that {{ .NewEmail }} should be the email address of your Randoo account from now on."],
      button: { label: "Confirm new address", url: LINK, showUrl: true },
    },
    reasonDe:
      "Du bekommst diese Mail, weil für dein Randoo-Konto eine neue E-Mail-Adresse angegeben wurde. Warst du das nicht, ändere bitte dein Passwort.",
    reasonEn:
      "You're getting this email because a new email address was set for your Randoo account. If that wasn't you, please change your password.",
  },
};

const pick = (de: string, en: string, both: string) =>
  `{{ if .Data.language }}{{ if eq .Data.language "de" }}${de}{{ else }}${en}{{ end }}{{ else }}${both}{{ end }}`;

for (const [file, t] of Object.entries(templates)) {
  const body = pick(
    sectionsHtml([t.de]),
    sectionsHtml([t.en]),
    sectionsHtml([t.de, { ...t.en, button: t.en.button && { ...t.en.button, showUrl: false } }]),
  );
  const reason = pick(reasonHtml(t.reasonDe), reasonHtml(t.reasonEn), reasonHtml(`${t.reasonDe}\n${t.reasonEn}`));
  Deno.writeTextFileSync(new URL(`./${file}`, import.meta.url), layoutHtml(body, reason, "de"));
}
