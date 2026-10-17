// The invite email's HTML, in the Salt Flats scene: the hovering car over the flats, then a white card in the
// scene's palette (app/globals.css `:root[data-scene="salt-flats"]`). @aimhuge/teams hands the mailer plain
// text only, so this reads the facts back out of that text (`inviteEmailBody`'s fixed wording); text it
// doesn't recognize gets no HTML and goes out as plain text, as before. Images come from the claim link's
// origin (`public/brand/email/`), so they load wherever the link does.

export interface InviteFacts {
  inviter: string;
  org: string;
  app: string;
  role: string;
  url: string;
}

const FIRST_LINE = /^(.+) invited you to join "(.+)" on (.+) as an? (\w+)\.$/;

export function parseInviteText(text: string): InviteFacts | null {
  const lines = text.split("\n");
  const [, inviter, org, app, role] = FIRST_LINE.exec(lines[0] ?? "") ?? [];
  const url = lines.find((line) => /^https?:\/\/\S+$/.test(line.trim()))?.trim();
  if (!inviter || !org || !app || !role || !url) return null;
  return { inviter, org, app, role, url };
}

const C = {
  canvas: "#eef1f6",
  card: "#ffffff",
  line: "#e3e5ec",
  ink: "#1d2133",
  muted: "#555b72",
  faint: "#868ca2",
  accent: "#b84f72",
};
const SANS = "Geist, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function inviteEmailHtml(facts: InviteFacts): string {
  const origin = new URL(facts.url).origin;
  const [inviter, org, app, role, url] = [facts.inviter, facts.org, facts.app, facts.role, facts.url].map(esc);
  const p = `margin:0 0 16px;font:15px/1.6 ${SANS};color:${C.muted};`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only"><title>Join ${org} on ${app}</title></head>
<body style="margin:0;padding:0;background:${C.canvas};">
<div style="display:none;max-height:0;overflow:hidden;">${inviter} invited you to the ${org} workspace on ${app}.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.canvas};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
<tr><td style="padding:0 4px 16px;font:600 15px/1 ${SANS};color:${C.ink};">
<img src="${origin}/brand/email/mark.png" width="24" height="24" alt="" style="vertical-align:middle;border-radius:6px;margin-right:8px;">${app}
</td></tr>
<tr><td style="background:${C.card};border:1px solid ${C.line};border-radius:16px;overflow:hidden;">
<img src="${origin}/brand/email/salt-flats.jpg" width="560" alt="A silver car hovering over a salt flat at dusk" style="display:block;width:100%;height:auto;border:0;border-radius:16px 16px 0 0;">
<div style="padding:32px 36px 36px;">
<p style="margin:0 0 8px;font:600 12px/1 ${SANS};letter-spacing:.08em;text-transform:uppercase;color:${C.accent};">You're invited</p>
<h1 style="margin:0 0 16px;font:600 26px/1.25 ${SANS};letter-spacing:-.01em;color:${C.ink};">Join ${org} on ${app}</h1>
<p style="${p}"><strong style="color:${C.ink};font-weight:600;">${inviter}</strong> invited you to the <strong style="color:${C.ink};font-weight:600;">${org}</strong> workspace as a ${role}.</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;"><tr>
<td style="background:${C.accent};border-radius:10px;"><a href="${url}" style="display:inline-block;padding:13px 26px;font:600 15px/1 ${SANS};color:#ffffff;text-decoration:none;">Accept invite</a></td>
</tr></table>
<p style="${p}">Sign in with the address this was sent to, or a different one. Both work.</p>
<p style="margin:0;padding-top:16px;border-top:1px solid ${C.line};font:13px/1.6 ${SANS};color:${C.faint};">Button not working? Open this link:<br><a href="${url}" style="color:${C.accent};word-break:break-all;">${url}</a></p>
</div></td></tr>
<tr><td style="padding:20px 4px 0;font:12px/1.6 ${SANS};color:${C.faint};">
The link expires in 14 days. If you weren't expecting this, ignore it and nothing will be created.<br>
<a href="${origin}" style="color:${C.faint};">${esc(new URL(origin).host)}</a>
</td></tr>
</table></td></tr></table>
</body></html>`;
}

// The HTML for a mailer message, or undefined when its text isn't an invite this recognizes.
export function inviteHtmlFor(text: string): string | undefined {
  const facts = parseInviteText(text);
  return facts ? inviteEmailHtml(facts) : undefined;
}
