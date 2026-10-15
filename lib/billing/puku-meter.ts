import "server-only";

// The Puku-side plan meter (docs/architecture/billing.md, lib/puku-proxy.ts): turns the user's plan into a
// "what's left of the workspace's Puku allowance this period" answer, and records what they spent. A null from
// `check` is "no Pro allowance" — the proxy keeps the daily free trial cap on for that user. Cached per user
// for 15 seconds, so a burst of requests doesn't hammer the database; each recorded charge also comes off every cached
// entry for its workspace, so the cache can't keep handing out tokens that are spent (or let a team spend it N times).

import type { SupabaseClient } from "@supabase/supabase-js";
import { catalog, PUKU_METER } from "./plans";
import { billing } from "./billing";
import { orgForUser } from "./org";
import type { PlanMeter } from "../puku-proxy";

const CACHE_MS = 15_000;

interface CacheEntry {
  expires: number;
  value: Awaited<ReturnType<PlanMeter["check"]>>;
}

// Per-user check cache, keyed by the Weft user id. Cleared by `resetMeterCache()` between tests.
const cache = new Map<string, CacheEntry>();

// Wipe the cache. Tests call this; production code never does.
export function resetMeterCache(): void {
  cache.clear();
}

// Take a charge off every cached answer for the workspace (several members share one allowance).
function spend(orgId: string, tokens: number): void {
  for (const entry of cache.values()) {
    if (entry.value?.orgId === orgId) entry.value = { orgId, remaining: Math.max(0, entry.value.remaining - tokens) };
  }
}

export function pukuMeter(service: SupabaseClient): PlanMeter {
  return {
    async check(userId) {
      const now = Date.now();
      const hit = cache.get(userId);
      if (hit && hit.expires > now) return hit.value;

      const org = await orgForUser(service, userId);
      if (!org) {
        cache.set(userId, { expires: now + CACHE_MS, value: null });
        return null;
      }
      const sub = await billing.subscription(service, org.id);
      const allowance = catalog.allowance(sub.plan, PUKU_METER);
      if (!allowance) {
        cache.set(userId, { expires: now + CACHE_MS, value: null });
        return null;
      }
      const balance = await billing.balance(service, org.id, PUKU_METER);
      // A free plan with no allowance on this meter, or a plan whose status is outside meteredStatuses (which
      // billing.balance maps to the free plan's allowance), gets the daily trial cap instead of a Pro
      // allowance. balance.allowance is 0 in both cases; null keeps the proxy on the Free path.
      if (balance.allowance === 0 && balance.granted === 0) {
        cache.set(userId, { expires: now + CACHE_MS, value: null });
        return null;
      }
      const value = { orgId: org.id, remaining: balance.remaining };
      cache.set(userId, { expires: now + CACHE_MS, value });
      return value;
    },
    async record(orgId, userId, tokens) {
      if (tokens <= 0) return;
      spend(orgId, tokens);
      await billing.recordUsage(service, { orgId, meter: PUKU_METER, amount: tokens, refType: "puku_request", createdBy: userId, createdVia: "system" });
    },
  };
}