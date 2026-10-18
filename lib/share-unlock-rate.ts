// A shared, server-side rate limit for POST /api/s/[id]/unlock (app/api/s/[id]/unlock/route.ts). The
// in-memory Map the route used to keep was keyed on the (trust-everyone) XFF chain and reset every
// redeploy; this module is the Supabase-backed replacement. The route hands in the service-role
// client, a hashed client ip, the share id, and a clock; the function does one upsert and decides
// whether to grant the attempt.
//
// Storage: a single row per (ip_hash, share_id) in public.share_unlock_attempts. The route's
// per-deployment pepper is hashed into ip_hash so two Weft deployments don't share a bucket space.
// The window roll and the bump happen in one Postgres function, public.share_unlock_bump
// (supabase/migrations/20261018045842_share_unlock_bump.sql): a single INSERT … ON CONFLICT DO UPDATE
// that takes the row lock, so two requests racing on the same bucket go in series and the second sees
// the first's count. The first version did a select and then an update in two round trips, and two
// racing POSTs could both read count < max and both pass (pentest 2026-10-18, F-2).
//
// Fails open on a Supabase error: a rate-limit outage shouldn't lock everyone out, and the route
// already 503s when there's no service key (the only path that makes the limit unreachable here).

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export const RATE_WINDOW_MS = 10 * 60 * 1000;
export const RATE_MAX = 10;

interface BumpRow {
  allowed: boolean;
  first_at: string;
}

// A verdict the route turns into a 429 or a pass. `windowResetAt` is the absolute time the bucket
// rolls over, exposed so the route can show a Retry-After hint.
export interface RateVerdict {
  allowed: boolean;
  windowResetAt: number;
}

// Records an attempt for (ipHash, shareId). Returns whether the caller is still under the limit and
// when the window rolls over. The clock is injected so tests can pin time without monkey-patching
// `Date.now`.
export async function checkAndRecord(
  service: SupabaseClient,
  ipHash: string,
  shareId: string,
  now: number,
  windowMs: number = RATE_WINDOW_MS,
  max: number = RATE_MAX,
): Promise<RateVerdict> {
  // The client isn't generated from the schema, so rpc's result is untyped; this is its shape.
  const result: { data: unknown; error: { message: string } | null } = await service.rpc("share_unlock_bump", {
    p_ip_hash: ipHash,
    p_share_id: shareId,
    p_now: new Date(now).toISOString(),
    p_window_ms: windowMs,
    p_max: max,
  });
  const { data, error } = result;
  const row = (Array.isArray(data) ? data[0] : data) as BumpRow | null | undefined;
  if (error || !row) {
    // Fail open; a rate-limit outage shouldn't take the route down.
    console.error(`share-unlock-rate: bump failed: ${error?.message ?? "no row returned"}`);
    return { allowed: true, windowResetAt: now + windowMs };
  }
  return { allowed: row.allowed, windowResetAt: Date.parse(row.first_at) + windowMs };
}

// Hashes the client IP with the deployment's pepper so two Weft deployments don't share a bucket
// space and a stolen DB row can't be matched back to a viewer without the pepper. Web Crypto is
// always present on the Next.js runtime.
export async function hashIp(ip: string, pepper: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${ip}|${pepper}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
