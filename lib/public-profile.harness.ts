// Shared fakes for the public-profile tests (lib/public-profile.test.ts,
// lib/public-profile-card.test.ts). A harness file is excluded from coverage
// (vitest.config.ts: `**/*.harness.ts`), so the helpers don't dilute the
// 100% line target on lib/public-profile.ts.
import type { SupabaseClient } from "@supabase/supabase-js";
import { vi } from "vitest";

export function profileRow(over: Partial<{ id: string; username: string; name: string | null; avatar_url: string | null; created_at: string }> = {}) {
  return { id: "u1", username: "alex", name: "Alex", avatar_url: "https://x/a.png", created_at: "2026-01-01T00:00:00.000Z", ...over };
}

export function shareRow(over: Partial<{ id: string; updated_at: string; cloud_cards: { card: unknown; deleted: boolean } | null }> = {}) {
  return { id: "s1", updated_at: "2026-10-01T00:00:00.000Z", cloud_cards: { card: { id: "c1", title: "T" }, deleted: false }, ...over };
}

// A row in league_weeks as the page reads it.
export function leagueRow(over: Partial<{ week: string; tier: number; cohort: number; xp: number; shipped: number }> = {}) {
  return { week: "2026-10-12", tier: 1, cohort: 1, xp: 120, shipped: 4, ...over };
}

// A row in cloud_app_shares as the page reads it.
export function appRow(over: Partial<{ id: string; name: string }> = {}) {
  return { id: "a1", name: "Growth", ...over };
}

// A row in profile_cards as the page reads it.
export function profileCardRow(over: Partial<{ card: unknown; updated_at: string }> = {}) {
  return { card: { className: "Finisher", xp: 1, level: { level: 1, title: "Thread", floor: 0, next: 0 }, streak: { current: 0, best: 0, freezes: 0 }, totals: { started: 0, shipped: 0 }, attributes: [], skills: [], badges: [], badgeCount: 0, cloth: [], usage: [], limitHits: { fiveHour: 0, sevenDay: 0 }, records: { biggestDay: null, mostShipped: null, fastestMs: null, maxRunning: 0 }, github: null }, updated_at: "2026-10-15T00:00:00.000Z", ...over };
}

// A query builder bound to a single table; each `from` returns a fresh chain that resolves to whatever
// the test set for that table on `fromTable`. `eq/order/limit` return the same chain; `maybeSingle`
// resolves the profile read; non-maybeSingle calls resolve the threads read.
export function fromTable(
  table: string,
  rows: {
    profile?: unknown;
    share?: unknown[] | null;
    sharesError?: { message: string } | null;
    profileError?: { message: string } | null;
    card?: { row: unknown; error: { message: string } | null } | null;
    league?: { latest: unknown; league: unknown[]; error: { message: string } | null } | null;
    apps?: { rows: unknown[] | null; error: { message: string } | null } | null;
  },
  options: { eqCalls?: { column: string; value: unknown }[]; orderCall?: { column: string; ascending: boolean }; limitCall?: number } = {},
) {
  // For league_weeks: the first .maybeSingle() resolves the "latest" row; subsequent .eq().eq().eq() resolves the cohort.
  const make = (): Record<string, unknown> => {
    const builder: Record<string, unknown> = {};
    const chainMethods = ["select", "eq", "order", "limit"];
    for (const m of chainMethods) {
      builder[m] = vi.fn((arg?: unknown) => {
        if (m === "limit" && typeof arg === "number") options.limitCall = arg;
        return make();
      });
    }
    if (table === "profiles") {
      builder.maybeSingle = vi.fn(() => Promise.resolve({ data: rows.profile ?? null, error: rows.profileError ?? null }));
    }
    if (table === "cloud_shares") {
      // The threads read resolves when the chain is awaited (no terminal method).
      Object.defineProperty(builder, "then", {
        get() {
          return (resolve: (v: unknown) => void) =>
            resolve({ data: rows.share ?? null, error: rows.sharesError ?? null });
        },
      });
    }
    if (table === "profile_cards") {
      builder.maybeSingle = vi.fn(() =>
        Promise.resolve({ data: rows.card?.row ?? null, error: rows.card?.error ?? null }),
      );
    }
    if (table === "league_weeks") {
      // The first maybeSingle in the chain is the "latest row" lookup; the second resolves the cohort.
      let consumed = 0;
      builder.maybeSingle = vi.fn(() => {
        consumed += 1;
        if (consumed === 1) return Promise.resolve({ data: rows.league?.latest ?? null, error: null });
        return Promise.resolve({ data: null, error: null });
      });
      Object.defineProperty(builder, "then", {
        get() {
          return (resolve: (v: unknown) => void) =>
            resolve({ data: rows.league?.league ?? [], error: rows.league?.error ?? null });
        },
      });
    }
    if (table === "cloud_app_shares") {
      Object.defineProperty(builder, "then", {
        get() {
          return (resolve: (v: unknown) => void) =>
            resolve({ data: rows.apps?.rows ?? null, error: rows.apps?.error ?? null });
        },
      });
    }
    return builder;
  };
  return make();
}

// A service client that records `from` calls and the chainable methods per table.
export function serviceWith(
  tables: Record<string, ReturnType<typeof fromTable>>,
): SupabaseClient {
  return {
    from: (table: string) => tables[table] ?? fromTable(table, {}),
  } as unknown as SupabaseClient;
}
