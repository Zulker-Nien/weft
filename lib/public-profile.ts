// A Weft account's public profile at weft.zip/@username (docs/architecture/profiles.md). next.config.ts rewrites
// /@:username to /u/:username, whose page calls loadPublicProfile. It reads through the service client, since
// profiles have no anon policy, and returns only what the page may show to anyone: never the email, the
// workspace or a card's folder. Threads are the account's share links set to "public" (lib/card-share.ts), apps its
// public mini app links (lib/app-share.ts); the builder card is what its Mac last posted (lib/profile-card.ts), and
// the league its latest week (supabase/migrations/20261017153548_leagues.sql).
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { leagueName } from "./league";
import { parseProfileCard, type ProfileCard } from "./profile-card";
import { serviceClient } from "./web-session";

// Shaped like a GitHub login, lowercased (supabase/migrations/20261017161000_profile_usernames.sql).
export const USERNAME_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
export const THREAD_LIMIT = 24;
export const APP_LIMIT = 12;

export interface PublicThread {
  id: string;
  title: string;
  updatedAt: string;
}

export interface PublicApp {
  id: string;
  name: string;
}

export interface PublicLeague {
  name: string;
  tier: number;
  week: string;
  xp: number;
  shipped: number;
  rank: number;
  size: number;
}

export interface PublicProfile {
  username: string;
  name: string | null;
  avatarUrl: string | null;
  githubUrl: string | null;
  memberSince: string;
  threads: PublicThread[];
  apps: PublicApp[];
  // What the account's Mac last posted, and when; null until it has.
  card: ProfileCard | null;
  cardAt: string | null;
  league: PublicLeague | null;
}

type ProfileRow = { id: string; username: string; name: string | null; avatar_url: string | null; created_at: string };
type LeagueRow = { week: string; tier: number; cohort: number; xp: number; shipped: number };
type ShareRow = { id: string; updated_at: string; cloud_cards: { card: unknown; deleted: boolean } | null };

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

// "@Alex", "%40alex" or "alex" → "alex"; null when it can't be a username, so the page 404s without a query.
export function parseUsername(raw: string): string | null {
  let s: string;
  try {
    s = decodeURIComponent(raw);
  } catch {
    return null;
  }
  s = s.trim().replace(/^@/, "").toLowerCase();
  return USERNAME_RE.test(s) ? s : null;
}

export const profilePath = (username: string) => `/@${username}`;

// A public share whose card still exists, as the page lists it; the card's title, or a stand-in when it has none.
export function toThread(row: ShareRow): PublicThread | null {
  const card = row.cloud_cards;
  if (!card || card.deleted) return null;
  const title = text((card.card as { title?: unknown } | null)?.title) ?? "Untitled thread";
  return { id: row.id, title, updatedAt: row.updated_at };
}

// The GitHub login the account signed in with, read from Auth (the username may be suffixed or email-made).
async function githubLogin(service: SupabaseClient, id: string): Promise<string | null> {
  try {
    const { data, error } = await service.auth.admin.getUserById(id);
    if (error) return null;
    return text(data.user.user_metadata.user_name);
  } catch {
    return null;
  }
}

// The account's latest league week and where it stands in it. Anything missing reads as no league.
async function latestLeague(service: SupabaseClient, id: string): Promise<PublicLeague | null> {
  try {
    const { data: row } = await service
      .from("league_weeks")
      .select("week, tier, cohort, xp, shipped")
      .eq("user_id", id)
      .order("week", { ascending: false })
      .limit(1)
      .maybeSingle<LeagueRow>();
    if (!row) return null;
    const { data: league } = await service.from("league_weeks").select("xp").eq("week", row.week).eq("tier", row.tier).eq("cohort", row.cohort);
    const xps = ((league ?? []) as { xp: number }[]).map((r) => r.xp);
    const rank = xps.filter((xp) => xp > row.xp).length + 1;
    return { name: leagueName(row.tier), tier: row.tier, week: row.week, xp: row.xp, shipped: row.shipped, rank, size: Math.max(xps.length, rank) };
  } catch {
    return null;
  }
}

async function builderCard(service: SupabaseClient, id: string): Promise<{ card: ProfileCard | null; at: string | null }> {
  const { data, error } = await service.from("profile_cards").select("card, updated_at").eq("user_id", id).maybeSingle<{ card: unknown; updated_at: string }>();
  if (error || !data) return { card: null, at: null };
  const card = parseProfileCard(data.card);
  return { card, at: card ? data.updated_at : null };
}

async function publicApps(service: SupabaseClient, id: string): Promise<PublicApp[]> {
  const { data, error } = await service
    .from("cloud_app_shares")
    .select("id, name")
    .eq("created_by", id)
    .eq("mode", "public")
    .order("updated_at", { ascending: false })
    .limit(APP_LIMIT);
  if (error) return [];
  return (data as { id: string; name: string }[]).map((a) => ({ id: a.id, name: text(a.name) ?? "Mini app" }));
}

export async function loadPublicProfile(raw: string, service: SupabaseClient | null = serviceClient()): Promise<PublicProfile | null> {
  const username = parseUsername(raw);
  if (!username || !service) return null;
  const { data: profile, error } = await service
    .from("profiles")
    .select("id, username, name, avatar_url, created_at")
    .eq("username", username)
    .maybeSingle<ProfileRow>();
  if (error || !profile) return null;
  const [shares, login, card, league, apps] = await Promise.all([
    service
      .from("cloud_shares")
      .select("id, updated_at, cloud_cards(card, deleted)")
      .eq("created_by", profile.id)
      .eq("mode", "public")
      .order("updated_at", { ascending: false })
      .limit(THREAD_LIMIT),
    githubLogin(service, profile.id),
    builderCard(service, profile.id).catch(() => ({ card: null, at: null })),
    latestLeague(service, profile.id),
    publicApps(service, profile.id).catch(() => []),
  ]);
  // A failed threads read still shows the profile, just without them.
  const rows = (shares.error ? [] : shares.data) as unknown as ShareRow[] | null;
  const threads = (rows ?? []).map(toThread).filter((t): t is PublicThread => t !== null);
  return {
    username: profile.username,
    name: text(profile.name),
    avatarUrl: text(profile.avatar_url),
    githubUrl: login ? `https://github.com/${login}` : null,
    memberSince: profile.created_at,
    threads,
    apps,
    card: card.card,
    cardAt: card.at,
    league,
  };
}
