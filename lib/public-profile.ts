// A Weft account's public profile at weft.zip/@username (docs/architecture/profiles.md). next.config.ts rewrites
// /@:username to /u/:username, whose page calls loadPublicProfile. It reads through the service client, since
// profiles have no anon policy, and returns only what the page may show to anyone: never the email, the
// workspace or a card's folder. Threads are the account's share links set to "public" (lib/card-share.ts).
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "./web-session";

// Shaped like a GitHub login, lowercased (supabase/migrations/20261017161000_profile_usernames.sql).
export const USERNAME_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
export const THREAD_LIMIT = 24;

export interface PublicThread {
  id: string;
  title: string;
  updatedAt: string;
}

export interface PublicProfile {
  username: string;
  name: string | null;
  avatarUrl: string | null;
  githubUrl: string | null;
  memberSince: string;
  threads: PublicThread[];
}

type ProfileRow = { id: string; username: string; name: string | null; avatar_url: string | null; created_at: string };
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

export async function loadPublicProfile(raw: string, service: SupabaseClient | null = serviceClient()): Promise<PublicProfile | null> {
  const username = parseUsername(raw);
  if (!username || !service) return null;
  const { data: profile, error } = await service
    .from("profiles")
    .select("id, username, name, avatar_url, created_at")
    .eq("username", username)
    .maybeSingle<ProfileRow>();
  if (error || !profile) return null;
  const [shares, login] = await Promise.all([
    service
      .from("cloud_shares")
      .select("id, updated_at, cloud_cards(card, deleted)")
      .eq("created_by", profile.id)
      .eq("mode", "public")
      .order("updated_at", { ascending: false })
      .limit(THREAD_LIMIT),
    githubLogin(service, profile.id),
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
  };
}
