// Shared look and wording for every mail the Edge Functions send, and for
// the Supabase Auth templates generated from the same renderer (see
// supabase/email-templates).
export type Lang = "en" | "de";
export type Kind = "idea" | "bug";

export const APP_URL = "https://demo.konstantingreger.net/randoo/";
export const IDEAS_URL = "https://demo.konstantingreger.net/ideas/";
const LOGO_URL = "https://demo.konstantingreger.net/randoo/mail/logo.png";

export type Section = {
  heading: string;
  paragraphs: string[];
  button?: { label: string; url: string; showUrl?: boolean };
};
export type Mail = { lang: string; sections: Section[]; reason: string };

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function sectionHtml(s: Section, first: boolean, last: boolean): string {
  const paragraphs = s.paragraphs
    .map((p) => `<p style="margin:0 0 14px;font-size:16px;line-height:1.55;">${esc(p)}</p>`)
    .join("");
  const button = s.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 4px;"><tr><td style="border-radius:8px;background:#ff8f6b;"><a href="${esc(s.button.url)}" style="display:inline-block;padding:13px 24px;font-family:${FONT};font-size:16px;font-weight:700;line-height:1;color:#241a30;text-decoration:none;border-radius:8px;">${esc(s.button.label)}</a></td></tr></table>` +
      (s.button.showUrl
        ? `<p style="margin:10px 0 0;font-size:12px;line-height:1.5;color:#6b6178;word-break:break-all;">${esc(s.button.url)}</p>`
        : "")
    : "";
  return `<tr><td style="padding:${first ? 32 : 24}px 32px ${last ? 32 : 24}px;font-family:${FONT};color:#241a30;"><h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;font-weight:700;color:#0e0c18;">${esc(s.heading)}</h1>${paragraphs}${button}</td></tr>`;
}

export function sectionsHtml(sections: Section[]): string {
  const divider = `<tr><td style="padding:0 32px;"><div style="border-top:1px solid #ece6ea;line-height:0;font-size:0;">&nbsp;</div></td></tr>`;
  return sections.map((s, i) => sectionHtml(s, i === 0, i === sections.length - 1)).join(divider);
}

export function reasonHtml(reason: string): string {
  return esc(reason).replace(/\n/g, "<br>");
}

// bodyRows and reason are inserted as given, so callers escape them (see
// sectionsHtml and reasonHtml); the email-templates generator relies on
// that to wrap them in Auth template conditionals.
export function layoutHtml(bodyRows: string, reason: string, lang: string, logoUrl: string = LOGO_URL): string {
  return `<!doctype html>
<html lang="${esc(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>Randoo</title>
</head>
<body style="margin:0;padding:0;background:#f7f1ef;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f1ef;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="560" align="center" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;margin:0 auto;">
<tr><td style="background:#0e0c18;border-radius:12px 12px 0 0;padding:22px 32px;"><a href="${APP_URL}" style="text-decoration:none;"><img src="${esc(logoUrl)}" alt="Randoo" width="150" style="display:block;border:0;width:150px;height:auto;font-family:${FONT};font-size:24px;font-weight:700;color:#f7f1ef;"></a></td></tr>
<tr><td style="padding:0;line-height:0;font-size:0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td width="50%" height="4" style="height:4px;background:#ff8f6b;line-height:4px;font-size:4px;">&nbsp;</td><td width="50%" height="4" style="height:4px;background:#ffbd6b;line-height:4px;font-size:4px;">&nbsp;</td></tr></table></td></tr>
<tr><td style="background:#ffffff;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${bodyRows}</table></td></tr>
<tr><td style="background:#ffffff;border-radius:0 0 12px 12px;line-height:0;font-size:0;height:4px;">&nbsp;</td></tr>
<tr><td style="padding:18px 32px 0;font-family:${FONT};font-size:12px;line-height:1.6;color:#6b6178;">${reason}<br><a href="${APP_URL}" style="color:#6b6178;">${APP_URL.replace("https://", "")}</a></td></tr>
</table>
</td></tr></table>
</body>
</html>
`;
}

export function renderMail(mail: Mail, opts: { logoUrl?: string } = {}): { html: string; text: string } {
  const html = layoutHtml(sectionsHtml(mail.sections), reasonHtml(mail.reason), mail.lang, opts.logoUrl);

  const text =
    mail.sections
      .map((s) => {
        const parts = [s.heading, ...s.paragraphs];
        if (s.button) parts.push(`${s.button.label}: ${s.button.url}`);
        return parts.join("\n\n");
      })
      .join("\n\n----------\n\n") +
    `\n\n--\n${mail.reason}\n${APP_URL}\n`;

  return { html, text };
}

const dePhrases: Record<Kind, { word: string; own: string; ownAcc: string; art: string; rel: string }> = {
  idea: { word: "Idee", own: "Deine Idee", ownAcc: "deine Idee", art: "die Idee", rel: "die" },
  bug: { word: "Bug", own: "Dein Bug", ownAcc: "deinen Bug", art: "der Bug", rel: "den" },
};

export function normalizeLang(value: unknown): Lang {
  return typeof value === "string" && value.toLowerCase().startsWith("de") ? "de" : "en";
}

export type Built = { subject: string; html: string; text: string };

function build(subject: string, mail: Mail): Built {
  return { subject: encodeSubject(subject), ...renderMail(mail) };
}

// The subject as it goes into the Subject header (RFC 2047, Base64, split into
// encoded words of at most 60 characters, which the header folds between).
//
// denomailer encodes a subject with non-ASCII characters on its own, but wraps
// the result after 74 characters with a quoted-printable soft line break. That
// is only a valid header fold when the next character happens to be a space;
// otherwise the following line is no header line, the mail's headers end there
// and the rest of them (From, To, MIME-Version, Content-Type) show up in the
// body. A subject that is plain ASCII and does not start with "=?" is passed
// through unchanged, so the encoded value is handed over like that: the space
// in front of it is the one denomailer's own "Subject: " would have anyway.
export function encodeSubject(subject: string): string {
  if (!/[^\x00-\x7f]/.test(subject)) return subject;

  const encoder = new TextEncoder();
  const words: string[] = [];
  let chunk: number[] = [];
  const flush = () => {
    if (chunk.length) words.push(`=?UTF-8?B?${btoa(String.fromCharCode(...chunk))}?=`);
    chunk = [];
  };
  // Cut between characters, never inside one.
  for (const char of subject) {
    const bytes = Array.from(encoder.encode(char));
    if (chunk.length + bytes.length > 36) flush();
    chunk.push(...bytes);
  }
  flush();
  return ` ${words.join("\r\n ")}`;
}

export function ideaReceived(lang: Lang, kind: Kind, title: string): Built {
  if (lang === "de") {
    const d = dePhrases[kind];
    return build(`${d.own} „${title}“ ist eingegangen`, {
      lang,
      sections: [
        {
          heading: `Wir haben ${d.ownAcc} erhalten`,
          paragraphs: [`Danke, dass du „${title}“ auf Randoos Ideenboard eingereicht hast.`, "Wir melden uns, sobald es angegangen wird."],
          button: { label: "Ideenboard öffnen", url: IDEAS_URL },
        },
      ],
      reason: `Du bekommst diese Mail, weil du diesen Eintrag (${d.word}) auf Randoos Ideenboard eingereicht hast.`,
    });
  }
  return build(`Your ${kind} "${title}" was received`, {
    lang,
    sections: [
      {
        heading: `We received your ${kind}`,
        paragraphs: [`Thanks for submitting "${title}" to Randoo's idea board.`, "We'll let you know once it's picked up."],
        button: { label: "Open the idea board", url: IDEAS_URL },
      },
    ],
    reason: `You're getting this email because you submitted this ${kind} on Randoo's idea board.`,
  });
}

export function ideaSubmittedAdmin(lang: Lang, kind: Kind, title: string): Built {
  if (lang === "de") {
    const d = dePhrases[kind];
    return build(`Neuer Eintrag: ${d.word} „${title}“`, {
      lang,
      sections: [
        {
          heading: kind === "bug" ? "Ein neuer Bug wurde eingereicht" : "Eine neue Idee wurde eingereicht",
          paragraphs: [`„${title}“ wurde gerade auf Randoos Ideenboard eingereicht.`],
          button: { label: "Ideenboard öffnen", url: IDEAS_URL },
        },
      ],
      reason: "Du bekommst diese Mail, weil du Admin bei Randoo bist.",
    });
  }
  return build(`New ${kind} submitted: "${title}"`, {
    lang,
    sections: [
      {
        heading: `A new ${kind} was submitted`,
        paragraphs: [`"${title}" was just submitted to Randoo's idea board.`],
        button: { label: "Open the idea board", url: IDEAS_URL },
      },
    ],
    reason: "You're getting this email because you're an admin on Randoo.",
  });
}

export function ideaResolved(lang: Lang, kind: Kind, title: string): Built {
  if (lang === "de") {
    const d = dePhrases[kind];
    const label = kind === "bug" ? "behoben" : "angenommen";
    return build(`${d.own} „${title}“ wurde als ${label} markiert`, {
      lang,
      sections: [
        {
          heading: `${d.art[0].toUpperCase()}${d.art.slice(1)} wurde als ${label} markiert`,
          paragraphs: [
            `Auf Randoos Ideenboard wurde ${d.art} „${title}“, ${d.rel} du eingereicht oder mit einem Upvote unterstützt hast, gerade als ${label} markiert.`,
            "Danke für dein Feedback.",
          ],
          button: { label: "Ideenboard öffnen", url: IDEAS_URL },
        },
      ],
      reason: "Du bekommst diese Mail, weil du diesen Eintrag auf Randoos Ideenboard eingereicht oder unterstützt hast.",
    });
  }
  const label = kind === "bug" ? "fixed" : "accepted";
  return build(`Your ${kind} "${title}" was marked ${label}`, {
    lang,
    sections: [
      {
        heading: `The ${kind} was marked ${label}`,
        paragraphs: [
          `The ${kind} "${title}" you submitted or upvoted on Randoo's idea board has just been marked as ${label}.`,
          "Thanks for the feedback.",
        ],
        button: { label: "Open the idea board", url: IDEAS_URL },
      },
    ],
    reason: "You're getting this email because you submitted or upvoted this on Randoo's idea board.",
  });
}

export function userRegistered(lang: Lang, email: string, displayName: string | null): Built {
  if (lang === "de") {
    return build(`Neue Randoo-Registrierung: ${email}`, {
      lang,
      sections: [
        {
          heading: "Ein neues Konto wurde bestätigt",
          paragraphs: [`E-Mail: ${email}`, `Anzeigename: ${displayName || "-"}`],
        },
      ],
      reason: "Du bekommst diese Mail, weil du Admin bei Randoo bist.",
    });
  }
  return build(`New Randoo signup: ${email}`, {
    lang,
    sections: [
      {
        heading: "A new account confirmed its address",
        paragraphs: [`Email: ${email}`, `Display name: ${displayName || "-"}`],
      },
    ],
    reason: "You're getting this email because you're an admin on Randoo.",
  });
}

// Mails go out grouped by language, one send per group, so each recipient
// gets the version from their own account setting (user_metadata.language,
// set in the app's account dialog) and nobody sees the rest of a group.
// deno-lint-ignore no-explicit-any
export async function groupByLanguage(adminClient: any, people: { id: string; email: string }[]) {
  const groups: Record<Lang, string[]> = { en: [], de: [] };
  for (const p of people) {
    const { data } = await adminClient.auth.admin.getUserById(p.id);
    groups[normalizeLang(data?.user?.user_metadata?.language)].push(p.email);
  }
  return groups;
}

export const FROM_NAME = "Randoo";
