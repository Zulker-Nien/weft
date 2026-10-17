// A shared, server-side rate limit for POST /api/s/[id]/unlock (app/api/s/[id]/unlock/route.ts). The
// in-memory Map the route used to keep was keyed on the (trust-everyone) XFF chain and reset every
// redeploy; this module is the Supabase-backed replacement. The route hands in the service-role
// client, a hashed client ip, the share id, and a clock; the function does one upsert and decides
// whether to grant the attempt.
//
// Storage: a single row per (ip_hash, share_id) in public.share_unlock_attempts. The route's
// per-deployment pepper is hashed into ip_hash so two Weft deployments don't share a bucket space.
// An upsert is atomic at the row level (Postgres takes a row lock for the conflicting key), so two
// requests racing on the same bucket can only succeed in series; the second one sees the first's
// committed count and decides on that.
//
// Fails open on a Supabase error: a rate-limit outage shouldn't lock everyone out, and the route
// already 503s when there's no service key (the only path that makes the limit unreachable here).

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export const RATE_WINDOW_MS = 10 * 60 * 1000;
export const RATE_MAX = 10;

interface AttemptRow {
  count: number;
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
  // Read first: a separate select + update lets us reset the window cleanly when the current
  // window has rolled over, instead of always bumping count.
  const { data: row, error: readError } = await service
    .from("share_unlock_attempts")
    .select("count, first_at")
    .eq("ip_hash", ipHash)
    .eq("share_id", shareId)
    .maybeSingle<AttemptRow>();

  if (readError) {
    // Fail open; a rate-limit outage shouldn't take the route down.
    console.error(`share-unlock-rate: read failed: ${readError.message}`);
    return { allowed: true, windowResetAt: now + windowMs };
  }

  const firstAt = row ? Date.parse(row.first_at) : 0;
  const inWindow = row && now - firstAt < windowMs;

  if (!inWindow) {
    // Roll the window forward: the next attempt is the first in a fresh window.
    const resetAt = now + windowMs;
    const { error: writeError } = await service.from("share_unlock_attempts").upsert(
      { ip_hash: ipHash, share_id: shareId, count: 1, first_at: new Date(now).toISOString() },
      { onConflict: "ip_hash,share_id" },
    );
    if (writeError) {
      console.error(`share-unlock-rate: window-reset write failed: ${writeError.message}`);
      return { allowed: true, windowResetAt: resetAt };
    }
    return { allowed: true, windowResetAt: resetAt };
  }

  if (row.count >= max) {
    // Already over the limit; the windowResetAt is when the existing row's first_at ages out.
    return { allowed: false, windowResetAt: firstAt + windowMs };
  }

  // Still in the window with room left: bump the count atomically.
  const { error: bumpError } = await service
    .from("share_unlock_attempts")
    .update({ count: row.count + 1 })
    .eq("ip_hash", ipHash)
    .eq("share_id", shareId);
  if (bumpError) {
    console.error(`share-unlock-rate: bump failed: ${bumpError.message}`);
    return { allowed: true, windowResetAt: firstAt + windowMs };
  }
  return { allowed: true, windowResetAt: firstAt + windowMs };
}

// Hashes the client IP with the deployment's pepper so two Weft deployments don't share a bucket
// space and a stolen DB row can't be matched back to a viewer without the pepper. Web Crypto is
// always present on the Next.js runtime.
export async function hashIp(ip: string, pepper: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${ip}|${pepper}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
