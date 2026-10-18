import { createHmac, timingSafeEqual } from "node:crypto";
import { copyFor, leagueMailHtml, leagueMailText } from "./league-mail-copy";
import { DAY_MS, planLeagueMails, utcWeek, type Builder, type LeagueMail, type SentMail, type WeekRow } from "./league-mail";

// The daily league-email run on the deployed Weft (app/api/league/emails, a Vercel cron): reads this week's and last
// week's league_weeks rows, the builders' profiles and what already went out (with SUPABASE_SECRET_KEY), lets
// lib/league-mail.ts pick the emails, and sends each through Resend. Each email is claimed in league_emails before
// it goes, so two runs can't both send it, and released if Resend refuses it, so the next run tries again.
// Unsubscribe links carry an HMAC of the user id (LEAGUE_EMAIL_SECRET), checked by app/api/league/unsubscribe.

export interface MailStore {
  weeks: (week: string) => Promise<WeekRow[]>;
  builders: (ids: string[]) => Promise<Builder[]>;
  sent: (sinceWeek: string) => Promise<SentMail[]>;
  // False when another run already claimed it.
  claim: (mail: { userId: string; kind: string; week: string }) => Promise<boolean>;
  release: (mail: { userId: string; kind: string; week: string }) => Promise<void>;
  optOut: (userId: string) => Promise<void>;
}

export interface OutgoingMail {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
}

export type SendMail = (mail: OutgoingMail) => Promise<void>;

export const FROM = "Weft <team@weft.zip>";

const sign = (userId: string, secret: string) => createHmac("sha256", secret).update(`league-unsubscribe:${userId}`).digest("base64url");

export function unsubscribeUrl(origin: string, userId: string, secret: string): string {
  return `${origin}/api/league/unsubscribe?u=${encodeURIComponent(userId)}&t=${sign(userId, secret)}`;
}

export function verifyUnsubscribe(userId: string, token: string, secret: string): boolean {
  const want = Buffer.from(sign(userId, secret));
  const got = Buffer.from(token);
  return got.length === want.length && timingSafeEqual(got, want);
}

export function outgoing(mail: LeagueMail, origin: string, secret: string): OutgoingMail {
  const links = { open: `${origin}/api/league/open`, unsubscribe: unsubscribeUrl(origin, mail.userId, secret), origin };
  const copy = copyFor(mail);
  return {
    to: mail.to,
    subject: copy.subject,
    html: leagueMailHtml(copy, links),
    text: leagueMailText(copy, links),
    // One-click unsubscribe (RFC 8058), which Gmail and Yahoo ask of senders like this.
    headers: { "List-Unsubscribe": `<${links.unsubscribe}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
  };
}

export interface RunResult {
  planned: number;
  sent: number;
  skipped: number;
  failed: string[];
}

// Resend allows a few sends a second per team; a short pause between emails stays under it.
export const SEND_GAP_MS = 600;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runLeagueMails(opts: {
  store: MailStore;
  send: SendMail;
  origin: string;
  secret: string;
  now: number;
  gapMs?: number;
}): Promise<RunResult> {
  const { store, send, origin, secret, now, gapMs = SEND_GAP_MS } = opts;
  const thisWeek = utcWeek(now);
  const lastWeek = utcWeek(now - 7 * DAY_MS);
  const [current, previous, sent] = await Promise.all([store.weeks(thisWeek), store.weeks(lastWeek), store.sent(lastWeek)]);
  const ids = [...new Set([...current, ...previous].map((r) => r.user_id))];
  const builders = ids.length ? await store.builders(ids) : [];
  const mails = planLeagueMails({ now, thisWeek: current, lastWeek: previous, builders, sent });
  const result: RunResult = { planned: mails.length, sent: 0, skipped: 0, failed: [] };
  for (const mail of mails) {
    const key = { userId: mail.userId, kind: mail.kind, week: mail.week };
    if (!(await store.claim(key))) {
      result.skipped++;
      continue;
    }
    try {
      if (result.sent + result.failed.length > 0) await wait(gapMs);
      await send(outgoing(mail, origin, secret));
      result.sent++;
    } catch (err) {
      await store.release(key);
      result.failed.push(`${mail.kind} ${mail.userId}: ${(err as Error).message}`);
    }
  }
  return result;
}

interface ProfileRow {
  id: string;
  email: string | null;
  display_name: string | null;
  name: string | null;
  league_emails: boolean | null;
  created_at: string;
}

const CHUNK = 100;

export function restMailStore(url: string, key: string, fetchFn: typeof fetch = fetch): MailStore {
  const headers: Record<string, string> = { apikey: key, "content-type": "application/json" };
  if (!key.startsWith("sb_")) headers.authorization = `Bearer ${key}`;
  async function rest(path: string, init: RequestInit = {}, ok: number[] = []) {
    const res = await fetchFn(`${url}/rest/v1/${path}`, { ...init, headers: { ...headers, ...(init.headers as Record<string, string> | undefined) } });
    if (!res.ok && !ok.includes(res.status)) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res;
  }
  const keyFilter = (m: { userId: string; kind: string; week: string }) =>
    `user_id=eq.${encodeURIComponent(m.userId)}&kind=eq.${encodeURIComponent(m.kind)}&week=eq.${m.week}`;
  return {
    weeks: async (week) => (await (await rest(`league_weeks?week=eq.${week}&select=user_id,week,tier,cohort,xp,shipped,streak`)).json()) as WeekRow[],
    builders: async (ids) => {
      const rows: ProfileRow[] = [];
      for (let i = 0; i < ids.length; i += CHUNK) {
        const list = ids.slice(i, i + CHUNK).map(encodeURIComponent).join(",");
        rows.push(...((await (await rest(`profiles?id=in.(${list})&select=id,email,display_name,name,league_emails,created_at`)).json()) as ProfileRow[]));
      }
      return rows.map((p) => ({
        id: p.id,
        email: p.email,
        name: p.display_name?.trim() || p.name?.trim() || "Builder",
        optedIn: p.league_emails !== false,
        createdAt: Date.parse(p.created_at),
      }));
    },
    sent: async (since) => (await (await rest(`league_emails?week=gte.${since}&select=user_id,kind,week`)).json()) as SentMail[],
    // 409: the row is there already, so another run has this email.
    claim: async (m) =>
      (
        await rest(
          "league_emails",
          { method: "POST", body: JSON.stringify({ user_id: m.userId, kind: m.kind, week: m.week }), headers: { prefer: "return=minimal" } },
          [409],
        )
      ).ok,
    release: async (m) => {
      await rest(`league_emails?${keyFilter(m)}`, { method: "DELETE" });
    },
    optOut: async (userId) => {
      await rest(`profiles?id=eq.${encodeURIComponent(userId)}`, { method: "PATCH", body: JSON.stringify({ league_emails: false }), headers: { prefer: "return=minimal" } });
    },
  };
}

// Resend's REST send (RESEND_API_KEY), as lib/teams.ts inviteMailer does.
export function resendSender(key: string, fetchFn: typeof fetch = fetch): SendMail {
  return async (mail) => {
    const res = await fetchFn("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from: FROM, to: [mail.to], subject: mail.subject, html: mail.html, text: mail.text, headers: mail.headers }),
    });
    if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
  };
}
