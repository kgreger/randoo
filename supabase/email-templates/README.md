# Auth email templates

HTML templates for the emails Supabase Auth sends. They share their layout with the Edge Function mails (`supabase/functions/_shared/mail.ts`) and are bilingual, German first, because a project has one template per mail and doesn't know the recipient's language.

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
