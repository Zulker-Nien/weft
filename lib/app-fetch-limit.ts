// The rate limit for /api/a/<id>/{fetch,read,env} (docs/architecture/mini-app-hosting.md). Three buckets:
// - 60 rows per minute per viewer (signed-in) or per client IP hash (anonymous)
// - 600 rows per minute per share (so one link can't be drained by N viewers)
// - and the cloud_app_fetches table (supabase/migrations/20261019095618_app_hosting.sql) is the source of truth
// The route inserts a row for every call (success or refusal) and asks this module for the verdict before
// doing the work, so the limit is "rows in the last 60 seconds", not "rows since the last check".
import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export const FETCH_PER_MINUTE_PER_VIEWER = 60;
export const FETCH_PER_MINUTE_PER_SHARE = 600;
export const FETCH_PER_MINIAPP_ANONYMOUS_PEPPER_FALLBACK = "weft-miniapp-anonymous-fallback";
const WINDOW_SECONDS = 60;
const WINDOW_MS = WINDOW_SECONDS * 1000;

// One bucket the caller can hit: a (share, viewerKey, count) tuple. The route answers 429 with retry-after
// only when ok is false; the count is included so a test can assert the limit was the reason.
export interface FetchLimitBucket {
  kind: "viewer" | "share" | "ip";
  key: string;
  count: number;
}

export interface FetchLimitVerdict {
  ok: boolean;
  // The bucket that pushed the request over, if any. The route uses it to set Retry-After.
  bucket?: FetchLimitBucket;
  // The number of seconds the caller should wait before trying again (WINDOW_SECONDS — the table is
  // the source of truth, so a fixed 60 is the safest answer).
  retryAfter: number;
}

// The client IP from a request, best-effort. x-forwarded-for may carry a comma list; the first hop is the
// client. In the deployed Vercel env it's set; locally it's localhost. An empty string is treated as
// "anonymous" so the limit is per-IP+share, not per-empty-key.
export function clientIpFromHeaders(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return (headers.get("x-real-ip") ?? "").trim();
}

// Per-process anonymous buckets: shareId|hash → list of timestamps inside the rolling window. Counts
// anonymous visitors separately so one IP can't drain the limit for the rest (the table only stores
// viewer_id null, not the IP, and adding an IP column would touch every row's tail). Per server
// instance: a multi-instance deploy counts the limit per replica, not globally; the per-share
// 600/min cap still bounds the worst case. Cleared between tests with resetAnonymousBuckets.
const anonymousBuckets = new Map<string, number[]>();

// Stable hash for an anonymous visitor: sha256(ip + WEFT_MINIAPP_KEY) so two visitors on the same
// proxy land in the same bucket, the raw IP never leaves the function, and a viewer without the key
// can't replay guesses. Empty ip maps to a fixed "anonymous" bucket so the rate limit still applies.
export function hashAnonymous(clientIp: string, pepper: string): string {
  const salt = pepper || FETCH_PER_MINIAPP_ANONYMOUS_PEPPER_FALLBACK;
  return createHash("sha256").update(`${clientIp}|${salt}`).digest("hex");
}

// Reads WEFT_MINIAPP_KEY as the pepper; falls back to the same constant when the env isn't set so
// the function never throws (route handlers expect a verdict, not an env error).
function pepperFromEnv(env: Record<string, string | undefined> = process.env): string {
  return env.WEFT_MINIAPP_KEY ?? FETCH_PER_MINIAPP_ANONYMOUS_PEPPER_FALLBACK;
}

// Prunes timestamps outside the rolling window from the bucket. Mutates the array in place to keep
// the cost low under bursts; the array is small (at most 60 entries per bucket).
function prune(window: number[], now: number): void {
  const cutoff = now - WINDOW_MS;
  let drop = 0;
  while (drop < window.length && (window[drop] ?? Number.MAX_SAFE_INTEGER) < cutoff) drop++;
  if (drop > 0) window.splice(0, drop);
}

// Records a hit for one anonymous visitor of one share and returns the rolling count.
export function recordAnonymousHit(shareId: string, clientIp: string, now: number = Date.now(), pepper: string = pepperFromEnv()): number {
  const hash = hashAnonymous(clientIp, pepper);
  const key = `${shareId}|${hash}`;
  const window = anonymousBuckets.get(key) ?? [];
  prune(window, now);
  window.push(now);
  anonymousBuckets.set(key, window);
  return window.length;
}

// Clears the per-process buckets; tests use this between cases.
export function resetAnonymousBuckets(): void {
  anonymousBuckets.clear();
}

// The current count for one anonymous visitor of one share, pruned but not incremented.
export function anonymousCount(shareId: string, clientIp: string, now: number = Date.now(), pepper: string = pepperFromEnv()): number {
  const hash = hashAnonymous(clientIp, pepper);
  const key = `${shareId}|${hash}`;
  const window = anonymousBuckets.get(key);
  if (!window) return 0;
  prune(window, now);
  return window.length;
}

// Counts rows in cloud_app_fetches in the last WINDOW_SECONDS, grouped the way the route cares about: a
// single (share, viewerId or ip) row count for the per-viewer bucket, and the per-share count on its own.
// The two counts come from one query each so the route can ask both without a join.
export async function countRecentFetches(
  service: SupabaseClient,
  shareId: string,
  viewerId: string | null,
  clientIp: string,
  now: Date = new Date(),
): Promise<{ viewer: number; share: number }> {
  const since = new Date(now.getTime() - WINDOW_SECONDS * 1000).toISOString();
  // Per-viewer count: viewer_id is either the user id or null, and the share is the same. An anonymous
  // visitor has viewer_id null; the per-share 600/min cap (and the per-process IP-hash bucket checked
  // separately) bounds the worst case.
  const [{ count: viewer }, { count: share }] = await Promise.all([
    countOne(service, shareId, viewerId, since),
    service
      .from("cloud_app_fetches")
      .select("id", { count: "exact", head: true })
      .eq("share_id", shareId)
      .gte("at", since),
  ]);
  return { viewer: viewer ?? 0, share: share ?? 0 };
}

async function countOne(
  service: SupabaseClient,
  shareId: string,
  viewerId: string | null,
  since: string,
): Promise<{ count: number | null }> {
  // Anonymous visitors are counted by their IP-hash bucket in process memory (recordAnonymousHit);
  // the table only knows the share id and viewer_id=null, so this query tells us how many null-viewer
  // rows the share has, without splitting visitors.
  const q = service
    .from("cloud_app_fetches")
    .select("id", { count: "exact", head: true })
    .eq("share_id", shareId)
    .gte("at", since);
  const { count } = viewerId === null ? await q.is("viewer_id", null) : await q.eq("viewer_id", viewerId);
  return { count };
}

// The verdict: per-viewer first (the smallest bucket — most likely to bite), then per-share. The route
// inserts the new row only when this returns ok, so the next call sees the count grow.
export async function fetchLimitVerdict(
  service: SupabaseClient,
  shareId: string,
  viewerId: string | null,
  clientIp: string,
  now: Date = new Date(),
  pepper: string = pepperFromEnv(),
): Promise<FetchLimitVerdict> {
  // Anonymous visitors get the per-process IP-hash bucket so one IP can't lock the rest out.
  if (viewerId === null) {
    const ip = anonymousCount(shareId, clientIp, now.getTime(), pepper);
    if (ip >= FETCH_PER_MINUTE_PER_VIEWER) {
      return {
        ok: false,
        bucket: { kind: "ip", key: `ip:${clientIp}`, count: ip },
        retryAfter: WINDOW_SECONDS,
      };
    }
  }
  const { viewer, share } = await countRecentFetches(service, shareId, viewerId, clientIp, now);
  if (viewer >= FETCH_PER_MINUTE_PER_VIEWER) {
    return {
      ok: false,
      bucket: { kind: viewerId ? "viewer" : "ip", key: viewerId ?? `ip:${clientIp}`, count: viewer },
      retryAfter: WINDOW_SECONDS,
    };
  }
  if (share >= FETCH_PER_MINUTE_PER_SHARE) {
    return {
      ok: false,
      bucket: { kind: "share", key: shareId, count: share },
      retryAfter: WINDOW_SECONDS,
    };
  }
  return { ok: true, retryAfter: 0 };
}

// Inserts one cloud_app_fetches row. The route calls this for every attempt (success and refusal) so the
// count is the actual traffic, not the success rate. host is the URL's hostname; path is the URL's
// pathname without the query string (we don't log query strings — they may carry a placeholder
// already and we never want to surface a value here).
export interface FetchLog {
  shareId: string;
  viewerId: string | null;
  method: string;
  host: string;
  path: string;
  status: number;
}

export async function insertFetchLog(service: SupabaseClient, log: FetchLog): Promise<void> {
  const { error } = await service.from("cloud_app_fetches").insert({
    share_id: log.shareId,
    viewer_id: log.viewerId,
    method: log.method,
    host: log.host,
    path: log.path,
    status: log.status,
  });
  if (error) console.error(`app-fetch-limit: log insert failed: ${error.message}`);
}
