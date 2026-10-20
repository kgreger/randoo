// Writes the Supabase Auth email templates (paste each file into the
// dashboard under Authentication > Emails). Run from the repo root:
//   deno run --allow-write supabase/email-templates/generate.ts
import { renderMail, type Mail } from "../functions/_shared/mail.ts";

const reason = (de: string, en: string) => `${de}\n${en}`;

const templates: Record<string, Mail> = {
  "confirm-signup.html": {
    lang: "de",
    sections: [
      {
        heading: "Willkommen bei Randoo",
        paragraphs: ["Bestätige deine E-Mail-Adresse {{ .Email }}, um dein Konto zu aktivieren."],
        button: { label: "E-Mail-Adresse bestätigen", url: "{{ .ConfirmationURL }}", showUrl: true },
      },
      {
        heading: "Welcome to Randoo",
        paragraphs: ["Confirm your email address {{ .Email }} to activate your account."],
        button: { label: "Confirm email address", url: "{{ .ConfirmationURL }}" },
      },
    ],
    reason: reason(
      "Du bekommst diese Mail, weil sich jemand mit dieser Adresse bei Randoo registriert hat. Warst du das nicht, kannst du sie ignorieren.",
      "You're getting this email because someone signed up to Randoo with this address. If that wasn't you, you can ignore it.",
    ),
  },
  "magic-link.html": {
    lang: "de",
    sections: [
      {
        heading: "Dein Anmeldelink",
        paragraphs: ["Mit diesem Link meldest du dich ohne Passwort bei Randoo an. Er funktioniert nur einmal und nur kurze Zeit."],
        button: { label: "Bei Randoo anmelden", url: "{{ .ConfirmationURL }}", showUrl: true },
      },
      {
        heading: "Your sign-in link",
        paragraphs: ["Use this link to sign in to Randoo without a password. It works once and only for a short time."],
        button: { label: "Sign in to Randoo", url: "{{ .ConfirmationURL }}" },
      },
    ],
    reason: reason(
      "Du bekommst diese Mail, weil für diese Adresse ein Anmeldelink angefordert wurde. Warst du das nicht, kannst du sie ignorieren.",
      "You're getting this email because a sign-in link was requested for this address. If that wasn't you, you can ignore it.",
    ),
  },
  "recovery.html": {
    lang: "de",
    sections: [
      {
        heading: "Passwort zurücksetzen",
        paragraphs: ["Wähle ein neues Passwort für dein Randoo-Konto."],
        button: { label: "Neues Passwort wählen", url: "{{ .ConfirmationURL }}", showUrl: true },
      },
      {
        heading: "Reset your password",
        paragraphs: ["Choose a new password for your Randoo account."],
        button: { label: "Choose a new password", url: "{{ .ConfirmationURL }}" },
      },
    ],
    reason: reason(
      "Du bekommst diese Mail, weil für diese Adresse ein neues Passwort angefordert wurde. Warst du das nicht, kannst du sie ignorieren.",
      "You're getting this email because a password reset was requested for this address. If that wasn't you, you can ignore it.",
    ),
  },
  "email-change.html": {
    lang: "de",
    sections: [
      {
        heading: "Neue E-Mail-Adresse bestätigen",
        paragraphs: ["Bestätige, dass {{ .NewEmail }} künftig die Adresse deines Randoo-Kontos sein soll."],
        button: { label: "Neue Adresse bestätigen", url: "{{ .ConfirmationURL }}", showUrl: true },
      },
      {
        heading: "Confirm your new email address",
        paragraphs: ["Confirm that {{ .NewEmail }} should be the email address of your Randoo account from now on."],
        button: { label: "Confirm new address", url: "{{ .ConfirmationURL }}" },
      },
    ],
    reason: reason(
      "Du bekommst diese Mail, weil für dein Randoo-Konto eine neue E-Mail-Adresse angegeben wurde. Warst du das nicht, ändere bitte dein Passwort.",
      "You're getting this email because a new email address was set for your Randoo account. If that wasn't you, please change your password.",
    ),
  },
};

for (const [file, mail] of Object.entries(templates)) {
  Deno.writeTextFileSync(new URL(`./${file}`, import.meta.url), renderMail(mail).html);
}
