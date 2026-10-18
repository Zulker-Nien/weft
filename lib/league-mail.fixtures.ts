// Fixtures and helpers shared by lib/league-mail*.test.ts files. All times here are UTC, never local (the test
// machine runs at UTC+7).

import { createHmac } from "node:crypto";
import type { Builder, LeagueMail, SentMail, WeekRow } from "./league-mail";
import type { MailStore, OutgoingMail, SendMail } from "./league-mail-send";

// Sun 18 Oct 2026, 00:00 UTC → thisWeek is "2026-10-12", lastWeek is "2026-10-05".
export const NOW = Date.UTC(2026, 9, 18, 0, 0, 0);
export const THIS_WEEK = "2026-10-12";
export const LAST_WEEK = "2026-10-05";

export const ORIGIN = "https://weft.zip";
export const SECRET = `whsec_${Buffer.from("a test signing key, 24 bytes").toString("base64")}`;

// Mon 12 Oct 2026, 00:00 UTC.
export const MONDAY = Date.UTC(2026, 9, 12, 0, 0, 0);
// 1 day after the Monday.
export const TUESDAY = Date.UTC(2026, 9, 13, 0, 0, 0);
export const THURSDAY = Date.UTC(2026, 9, 15, 0, 0, 0);
export const FRIDAY = Date.UTC(2026, 9, 16, 0, 0, 0);
export const SATURDAY = Date.UTC(2026, 9, 17, 0, 0, 0);
export const SUNDAY = Date.UTC(2026, 9, 18, 0, 0, 0);

export const row = (over: Partial<WeekRow> = {}): WeekRow => ({
  user_id: "u1",
  week: THIS_WEEK,
  tier: 0,
  cohort: 0,
  xp: 100,
  shipped: 3,
  streak: 1,
  ...over,
});

export const builder = (over: Partial<Builder> = {}): Builder => ({
  id: "u1",
  email: "u1@weft.test",
  name: "Alex",
  optedIn: true,
  createdAt: Date.UTC(2026, 9, 12, 0, 0, 0),
  ...over,
});

export const welcomeMail = (userId = "u1", to = "u1@w.test"): LeagueMail => ({
  kind: "welcome",
  userId,
  to,
  week: THIS_WEEK,
  facts: {
    name: "Alex",
    league: "Cotton",
    week: THIS_WEEK,
    rank: 1,
    size: 1,
    xp: 0,
    up: 0,
    down: 0,
    daysLeft: 4,
    top: [{ rank: 1, name: "Alex", xp: 0, isMe: true }],
  },
});

export const sign = (userId: string) =>
  createHmac("sha256", SECRET).update(`league-unsubscribe:${userId}`).digest("base64url");

// In-memory MailStore for the runLeagueMails tests. `claims` tracks which (user, kind, week) are claimed; the test
// can override `send` to throw.
export function makeStore() {
  const weeks: Record<string, WeekRow[]> = {
    [THIS_WEEK]: [
      { user_id: "u1", week: THIS_WEEK, tier: 0, cohort: 0, xp: 100, shipped: 3, streak: 1 },
      { user_id: "u2", week: THIS_WEEK, tier: 0, cohort: 0, xp: 50, shipped: 1, streak: 1 },
    ],
    [LAST_WEEK]: [
      { user_id: "u1", week: LAST_WEEK, tier: 0, cohort: 0, xp: 100, shipped: 3, streak: 1 },
    ],
  };
  const builders: Record<string, Builder> = {
    u1: { id: "u1", email: "u1@w.test", name: "Alex", optedIn: true, createdAt: NOW - 1 * 24 * 60 * 60 * 1000 },
    u2: { id: "u2", email: "u2@w.test", name: "Bo", optedIn: true, createdAt: NOW - 1 * 24 * 60 * 60 * 1000 },
  };
  const sent: SentMail[] = [];
  const claims = new Set<string>();
  const key = (m: { userId: string; kind: string; week: string }) => `${m.userId}:${m.kind}:${m.week}`;
  const store: MailStore = {
    weeks: (week) => Promise.resolve(weeks[week] ?? []),
    builders: (ids) => Promise.resolve(ids.map((id) => builders[id]).filter((b): b is Builder => Boolean(b))),
    sent: () => Promise.resolve(sent),
    claim: (m) => {
      const k = key(m);
      if (claims.has(k)) return Promise.resolve(false);
      claims.add(k);
      return Promise.resolve(true);
    },
    release: (m) => {
      claims.delete(key(m));
      return Promise.resolve();
    },
    optOut: () => Promise.resolve(),
  };
  const sentMails: OutgoingMail[] = [];
  let sendImpl: SendMail = (m) => {
    sentMails.push(m);
    return Promise.resolve();
  };
  return {
    store,
    getSend: () => sendImpl,
    setSend: (s: SendMail) => {
      sendImpl = s;
    },
    sent: sentMails,
  };
}