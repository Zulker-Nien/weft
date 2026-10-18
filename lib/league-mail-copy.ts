import { XP } from "./game";
import type { LeagueFacts, LeagueMail, ResultFacts, Standing, StandingFacts } from "./league-mail";

// The words of each league email (lib/league-mail.ts picks who gets which): subject, preheader, plain text and the
// HTML, in the invite email's Salt Flats card (lib/invite-email.ts). Every email ends with a one-click unsubscribe.

export interface MailCopy {
  subject: string;
  preheader: string;
  heading: string;
  eyebrow: string;
  paragraphs: string[];
  table: Standing[];
  tableTitle: string;
}

export interface Links {
  // Where the button goes: opens Weft on the league (app/api/league/open).
  open: string;
  unsubscribe: string;
  // weft.zip, for the images and the footer.
  origin: string;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const ordinal = (n: number) => `#${n}`;
// XP in shipped cards, the unit a builder thinks in.
const cards = (xp: number) => plural(Math.max(1, Math.ceil(xp / XP.done)), "shipped card");
const days = (n: number) => (n === 1 ? "today's the last day" : `${n} days left`);

function rules(f: LeagueFacts): string {
  if (f.size < 2) return "You're the first one here. When others join, the top builders move up a league every Monday.";
  const down = f.down > 0 ? ` and the bottom ${f.down} move down` : "";
  return `Every Monday the top ${f.up} move up a league${down}. XP comes from your threads: ${XP.done} for each card you ship, a little for every turn.`;
}

function welcome(f: LeagueFacts): MailCopy {
  return {
    subject: `Welcome to the ${f.league} league`,
    preheader: f.size > 1 ? `You're one of ${plural(f.size, "builder")} this week; ${days(f.daysLeft)}.` : `The week ends Sunday; ${days(f.daysLeft)}.`,
    eyebrow: "Your league",
    heading: `You're in ${f.league}`,
    paragraphs: [
      `Hi ${f.name}, signing in to Weft put you in a weekly league${f.size > 1 ? ` with ${plural(f.size - 1, "other builder")}` : ""}. It runs Monday to Sunday, ranked by the XP you earn that week; ${days(f.daysLeft)}.`,
      rules(f),
      "Ship a card today and you're on the board.",
    ],
    tableTitle: `${f.league} this week`,
    table: f.top,
  };
}

function standing(kind: "midweek" | "final", f: StandingFacts): MailCopy {
  const last = kind === "final";
  const prefix = last ? "Last day: " : "";
  const when = last ? "by the end of today" : `in the ${plural(f.daysLeft, "day")} left`;
  const base = { tableTitle: `${f.league} right now`, table: f.top, eyebrow: last ? "Last day of the week" : "Midweek standing" };
  if (f.zone === "up") {
    const lead = f.lead > 0 ? ` You're ${f.lead} XP ahead of the first builder outside it.` : "";
    return {
      ...base,
      subject: `${prefix}${last ? "you" : "You"}'re ${ordinal(f.rank)} in ${f.league}, in the move-up zone`,
      preheader: `Hold a top-${f.up} spot ${when} and you move up on Monday.`,
      heading: `${ordinal(f.rank)} of ${f.size}: you're moving up`,
      paragraphs: [`Hi ${f.name}, you have ${f.xp} XP this week, a top-${f.up} spot in ${f.league}.${lead}`, `Keep it ${when} and Monday moves you up a league.`],
    };
  }
  if (f.zone === "down") {
    return {
      ...base,
      subject: `${prefix}${f.gap} XP keeps you in ${f.league}`,
      preheader: `You're ${ordinal(f.rank)} of ${f.size}, in the bottom ${f.down}. About ${cards(f.gap)} gets you out.`,
      heading: `${f.gap} XP to stay in ${f.league}`,
      paragraphs: [
        `Hi ${f.name}, you're ${ordinal(f.rank)} of ${f.size} with ${f.xp} XP, in the bottom ${f.down}, who move down a league on Monday.`,
        `${f.gap} XP ${when} gets you out of it: about ${cards(f.gap)}.`,
      ],
    };
  }
  return {
    ...base,
    subject: `${prefix}${f.gap} XP from moving up`,
    preheader: `You're ${ordinal(f.rank)} of ${f.size} in ${f.league}; the top ${f.up} move up on Monday.`,
    heading: `${f.gap} XP from the top ${f.up}`,
    paragraphs: [
      `Hi ${f.name}, you're ${ordinal(f.rank)} of ${f.size} in ${f.league} with ${f.xp} XP. The top ${f.up} move up a league on Monday.`,
      `${f.gap} XP ${when} puts you in: about ${cards(f.gap)}.`,
    ],
  };
}

function results(f: ResultFacts): MailCopy {
  const week = `${ordinal(f.rank)} of ${f.size} with ${f.xp} XP and ${plural(f.shipped, "card")} shipped`;
  const base = { eyebrow: "Last week's results", tableTitle: `${f.league}, final`, table: f.top.slice(0, 3) };
  if (f.move === "up") {
    return {
      ...base,
      subject: `You moved up to ${f.next}`,
      preheader: `You finished ${week}.`,
      heading: `Welcome to ${f.next}`,
      paragraphs: [`Hi ${f.name}, you finished last week ${week}, a top-${f.up} spot in ${f.league}.`, `This week you're in ${f.next}, with builders who moved up too. Same rules: the week ends Sunday.`],
    };
  }
  if (f.move === "down") {
    const effort = f.xp === 0 ? "a quiet week" : week;
    return {
      ...base,
      subject: `You moved down to ${f.next}`,
      preheader: `A fresh week starts today; the top builders in ${f.next} move back up next Monday.`,
      heading: `This week: ${f.next}`,
      paragraphs: [`Hi ${f.name}, after ${effort} in ${f.league} you start this week in ${f.next}.`, `It's a fresh week: finish near the top of ${f.next} and Monday moves you back up.`],
    };
  }
  return {
    ...base,
    subject: `You held your place in ${f.league}`,
    preheader: `You finished ${week}.`,
    heading: `${ordinal(f.rank)} of ${f.size} in ${f.league}`,
    paragraphs: [`Hi ${f.name}, you finished last week ${week}.`, `You stay in ${f.league} this week, in a fresh league with everyone at 0 XP.`],
  };
}

export function copyFor(mail: LeagueMail): MailCopy {
  if (mail.kind === "welcome") return welcome(mail.facts);
  if (mail.kind === "results") return results(mail.facts);
  return standing(mail.kind, mail.facts);
}

const C = { canvas: "#eef1f6", card: "#ffffff", line: "#e3e5ec", ink: "#1d2133", muted: "#555b72", faint: "#868ca2", accent: "#b84f72", tint: "#f8eef2" };
const SANS = "Geist, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function tableHtml(title: string, rows: Standing[]): string {
  const cell = `padding:9px 12px;font:14px/1.3 ${SANS};border-top:1px solid ${C.line};`;
  const body = rows
    .map((r) => {
      const me = r.isMe ? `background:${C.tint};font-weight:600;color:${C.ink};` : `color:${C.muted};`;
      return `<tr><td style="${cell}${me}width:36px;">${ordinal(r.rank)}</td><td style="${cell}${me}">${esc(r.name)}${r.isMe ? " (you)" : ""}</td><td style="${cell}${me}text-align:right;">${r.xp} XP</td></tr>`;
    })
    .join("");
  return `<p style="margin:24px 0 8px;font:600 12px/1 ${SANS};letter-spacing:.08em;text-transform:uppercase;color:${C.faint};">${esc(title)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.line};border-radius:10px;border-collapse:separate;overflow:hidden;">${body}</table>`;
}

export function leagueMailHtml(copy: MailCopy, links: Links): string {
  const [open, unsubscribe, origin] = [links.open, links.unsubscribe, links.origin].map(esc);
  const p = `margin:0 0 16px;font:15px/1.6 ${SANS};color:${C.muted};`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only"><title>${esc(copy.subject)}</title></head>
<body style="margin:0;padding:0;background:${C.canvas};">
<div style="display:none;max-height:0;overflow:hidden;">${esc(copy.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.canvas};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
<tr><td style="padding:0 4px 16px;font:600 15px/1 ${SANS};color:${C.ink};">
<img src="${origin}/brand/email/mark.png" width="24" height="24" alt="" style="vertical-align:middle;border-radius:6px;margin-right:8px;">Weft
</td></tr>
<tr><td style="background:${C.card};border:1px solid ${C.line};border-radius:16px;overflow:hidden;">
<div style="padding:32px 36px 36px;">
<p style="margin:0 0 8px;font:600 12px/1 ${SANS};letter-spacing:.08em;text-transform:uppercase;color:${C.accent};">${esc(copy.eyebrow)}</p>
<h1 style="margin:0 0 16px;font:600 26px/1.25 ${SANS};letter-spacing:-.01em;color:${C.ink};">${esc(copy.heading)}</h1>
${copy.paragraphs.map((text) => `<p style="${p}">${esc(text)}</p>`).join("\n")}
${copy.table.length ? tableHtml(copy.tableTitle, copy.table) : ""}
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 0;"><tr>
<td style="background:${C.accent};border-radius:10px;"><a href="${open}" style="display:inline-block;padding:13px 26px;font:600 15px/1 ${SANS};color:#ffffff;text-decoration:none;">Open your league</a></td>
</tr></table>
</div></td></tr>
<tr><td style="padding:20px 4px 0;font:12px/1.6 ${SANS};color:${C.faint};">
You get this because you're in a Weft league. <a href="${unsubscribe}" style="color:${C.faint};">Stop league emails</a><br>
<a href="${origin}" style="color:${C.faint};">${esc(new URL(links.origin).host)}</a>
</td></tr>
</table></td></tr></table>
</body></html>`;
}

export function leagueMailText(copy: MailCopy, links: Links): string {
  const table = copy.table.map((r) => `${ordinal(r.rank)}  ${r.name}${r.isMe ? " (you)" : ""}  ${r.xp} XP`).join("\n");
  return [copy.heading, "", ...copy.paragraphs.flatMap((t) => [t, ""]), ...(table ? [`${copy.tableTitle}:`, table, ""] : []), `Open your league: ${links.open}`, "", `Stop league emails: ${links.unsubscribe}`].join("\n");
}
