# Auth email templates

HTML templates for the emails Supabase Auth sends. They share their layout with the Edge Function mails (`supabase/functions/_shared/mail.ts`).

## Language

Each template reads `user_metadata.language` from the account (`{{ .Data.language }}`): German for `de`, English for anything else that is set, and both languages stacked, German first, when it isn't set. The app stores the browser's language there when someone signs up or requests their first magic link, and the account dialog changes it later. Accounts created before that have no value and get the stacked version until they pick a language. The subject lines below stay bilingual, since the dashboard subject field can't switch on the account.

| File | Template in the dashboard | Subject |
| --- | --- | --- |
| `confirm-signup.html` | Confirm sign up | Bestätige dein Randoo-Konto / Confirm your Randoo account |
| `magic-link.html` | Magic link | Dein Randoo-Anmeldelink / Your Randoo sign-in link |
| `recovery.html` | Reset password | Randoo-Passwort zurücksetzen / Reset your Randoo password |
| `email-change.html` | Change email address | Neue E-Mail-Adresse bestätigen / Confirm your new email address |

## Applying

Nothing here is deployed automatically. In the Supabase dashboard open Authentication, Emails, and for each template paste the file's contents and set the subject from the table. The sender name ("Randoo") is set under Authentication, SMTP Settings.

The templates use Supabase's template variables (`{{ .ConfirmationURL }}`, `{{ .Email }}`, `{{ .NewEmail }}`), which the dashboard fills in.

## Logo

The header image is loaded from `https://demo.konstantingreger.net/randoo/mail/logo.png`, which is `frontend/public/mail/logo.png` once the frontend is deployed. If the app moves to another domain, change `LOGO_URL` and `APP_URL` in `_shared/mail.ts` and regenerate.

## Regenerating

Edit the texts in `generate.ts` (or the layout in `_shared/mail.ts`) and run from the repository root:

```
deno run --allow-write supabase/email-templates/generate.ts
```
