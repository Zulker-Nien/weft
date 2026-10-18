import type { GameState } from "./game-server";
import type { GithubProfile } from "./github-profile";

// The public builder card on weft.zip/@username (docs/architecture/profiles.md): what the Loom's "You" tab
// shows, as the signed-in Mac posts it (lib/profile-card-sync.ts) into profile_cards
// (supabase/migrations/20261018135430_profile_cards.sql). Never prompts, code, project names or folders: the
// Projects tab stays on the Mac. The page parses the row again with parseProfileCard, since anyone signed in
// can post any JSON as themselves. Client-safe: no server imports.

export interface CardAttribute {
  icon: string;
  label: string;
  value: number;
  hint: string;
}

export interface CardBadge {
  icon: string;
  name: string;
  desc: string;
  group: string;
  at: number | null;
}

export interface CardDay {
  day: string;
  xp: number;
  // 0 (nothing) to 4 (a big day); -1 for a day a streak freeze covered.
  tone: number;
}

export interface CardUsageDay {
  day: string;
  tokens: number;
  fiveHour: number;
  sevenDay: number;
}

export interface CardGithub {
  login: string;
  bio: string | null;
  company: string | null;
  location: string | null;
  blog: string | null;
  followers: number;
  publicRepos: number;
}

export interface ProfileCard {
  className: string;
  xp: number;
  level: { level: number; title: string; floor: number; next: number };
  streak: { current: number; best: number; freezes: number };
  totals: { started: number; shipped: number };
  attributes: CardAttribute[];
  skills: { tech: string; level: number }[];
  badges: CardBadge[];
  badgeCount: number;
  cloth: CardDay[];
  usage: CardUsageDay[];
  limitHits: { fiveHour: number; sevenDay: number };
  records: {
    biggestDay: { day: string; cards: number } | null;
    mostShipped: { day: string; done: number } | null;
    fastestMs: number | null;
    maxRunning: number;
  };
  github: CardGithub | null;
}

const BADGES = 60;
const CLOTH = 26 * 7;
const USAGE = 30;
const ATTRS = 7;
const SKILLS = 8;

// The Mac's side: the Loom's game state (and the gh profile /api/game adds) as the page will draw it.
export function profileCard(game: GameState, github: GithubProfile | null | undefined): ProfileCard {
  const r = game.records;
  return {
    className: game.className,
    xp: game.xp,
    level: { level: game.level.level, title: game.level.title, floor: game.level.floor, next: game.level.next },
    streak: { current: game.streak.current, best: game.streak.best, freezes: game.streak.freezes },
    totals: game.totals,
    attributes: game.attributes.map((a) => ({ icon: a.icon, label: a.label, value: a.value, hint: a.hint })),
    skills: game.skills.map((s) => ({ tech: s.tech, level: s.level })),
    badges: game.badges
      .filter((b) => b.unlocked)
      .sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
      .map((b) => ({ icon: b.icon, name: b.name, desc: b.desc, group: b.group, at: b.at ?? null })),
    badgeCount: game.badges.length,
    cloth: game.cloth.map((s) => ({ day: s.day, xp: s.xp, tone: s.tone })),
    usage: game.usage.map((d) => ({ day: d.day, tokens: d.input + d.output, fiveHour: d.fiveHour, sevenDay: d.sevenDay })),
    limitHits: game.limitHits,
    records: { biggestDay: r.biggestDay, mostShipped: r.mostShipped, fastestMs: r.fastest, maxRunning: r.maxRunning },
    github: github
      ? {
          login: github.login,
          bio: github.bio,
          company: github.company,
          location: github.location,
          blog: github.blog,
          followers: github.followers,
          publicRepos: github.publicRepos,
        }
      : null,
  };
}

// ---- The page's side: every field read again, clamped and cut to size.

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);
const list = (v: unknown, max: number): unknown[] => (Array.isArray(v) ? v.slice(0, max) : []);
const num = (v: unknown, min: number, max: number, fallback = min) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback;
const str = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const day = (v: unknown): string | null => (typeof v === "string" && DAY_RE.test(v) ? v : null);
const BIG = 1e12;

// Only plain http(s) links, so a post can't put a javascript: URL on the page.
export function safeUrl(v: unknown): string | null {
  const s = str(v, 200);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

function parseGithub(v: unknown): CardGithub | null {
  const g = obj(v);
  const login = str(g?.login, 39);
  if (!g || !login || !/^[A-Za-z0-9-]+$/.test(login)) return null;
  return {
    login,
    bio: str(g.bio, 280),
    company: str(g.company, 80),
    location: str(g.location, 80),
    blog: safeUrl(g.blog),
    followers: num(g.followers, 0, BIG),
    publicRepos: num(g.publicRepos, 0, BIG),
  };
}

function parseRecords(v: unknown): ProfileCard["records"] {
  const r = obj(v) ?? {};
  const big = obj(r.biggestDay);
  const most = obj(r.mostShipped);
  const bigDay = day(big?.day);
  const mostDay = day(most?.day);
  return {
    biggestDay: big && bigDay ? { day: bigDay, cards: num(big.cards, 0, BIG) } : null,
    mostShipped: most && mostDay ? { day: mostDay, done: num(most.done, 0, BIG) } : null,
    fastestMs: typeof r.fastestMs === "number" ? num(r.fastestMs, 0, BIG) : null,
    maxRunning: num(r.maxRunning, 0, 10_000),
  };
}

const filled = <T>(items: (T | null)[]): T[] => items.filter((x): x is T => x !== null);

function parseAttribute(v: unknown): CardAttribute | null {
  const a = obj(v);
  const label = str(a?.label, 30);
  return a && label ? { icon: str(a.icon, 8) ?? "•", label, value: num(a.value, 0, 100), hint: str(a.hint, 120) ?? "" } : null;
}

function parseSkill(v: unknown): ProfileCard["skills"][number] | null {
  const s = obj(v);
  const tech = str(s?.tech, 30);
  return s && tech ? { tech, level: num(s.level, 0, 1000) } : null;
}

function parseBadge(v: unknown): CardBadge | null {
  const b = obj(v);
  const name = str(b?.name, 40);
  if (!b || !name) return null;
  return {
    icon: str(b.icon, 8) ?? "🏅",
    name,
    desc: str(b.desc, 120) ?? "",
    group: str(b.group, 30) ?? "Milestones",
    at: typeof b.at === "number" ? num(b.at, 0, BIG) : null,
  };
}

function parseStitch(v: unknown): CardDay | null {
  const s = obj(v);
  const d = day(s?.day);
  return s && d ? { day: d, xp: num(s.xp, 0, BIG), tone: num(s.tone, -1, 4) } : null;
}

function parseUsageDay(v: unknown): CardUsageDay | null {
  const u = obj(v);
  const d = day(u?.day);
  return u && d ? { day: d, tokens: num(u.tokens, 0, BIG), fiveHour: num(u.fiveHour, 0, 100), sevenDay: num(u.sevenDay, 0, 100) } : null;
}

export function parseProfileCard(raw: unknown): ProfileCard | null {
  const c = obj(raw);
  const level = obj(c?.level);
  if (!c || !level) return null;
  const streak = obj(c.streak) ?? {};
  const totals = obj(c.totals) ?? {};
  const hits = obj(c.limitHits) ?? {};
  return {
    className: str(c.className, 40) ?? "Apprentice",
    xp: num(c.xp, 0, BIG),
    level: {
      level: num(level.level, 1, 10_000, 1),
      title: str(level.title, 30) ?? "Thread",
      floor: num(level.floor, 0, BIG),
      next: num(level.next, 0, BIG),
    },
    streak: { current: num(streak.current, 0, 100_000), best: num(streak.best, 0, 100_000), freezes: num(streak.freezes, 0, 10) },
    totals: { started: num(totals.started, 0, BIG), shipped: num(totals.shipped, 0, BIG) },
    attributes: filled(list(c.attributes, ATTRS).map(parseAttribute)),
    skills: filled(list(c.skills, SKILLS).map(parseSkill)),
    badges: filled(list(c.badges, BADGES).map(parseBadge)),
    badgeCount: num(c.badgeCount, 0, 1000),
    cloth: filled(list(c.cloth, CLOTH).map(parseStitch)),
    usage: filled(list(c.usage, USAGE).map(parseUsageDay)),
    limitHits: { fiveHour: num(hits.fiveHour, 0, 100_000), sevenDay: num(hits.sevenDay, 0, 100_000) },
    records: parseRecords(c.records),
    github: parseGithub(c.github),
  };
}
