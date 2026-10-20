// Shared test helpers for lib/app-share-access.test.ts and lib/app-share-access-by-slug.test.ts.
// The vi.hoisted mocks can't be re-exported from a helper, so each test file declares its own;
// only the pure helpers live here. The split keeps both test files under the 300-line cap.
import type { SupabaseClient } from "@supabase/supabase-js";
import { vi } from "vitest";

export function appShareRow(over: Partial<{
  id: string;
  org_id: string;
  app_id: string;
  name: string;
  mode: string;
  owner: "user" | "org";
  slug: string | null;
  created_by: string;
  password_hash: string | null;
}> = {}) {
  return {
    id: "a1",
    org_id: "org-1",
    app_id: "app-1",
    name: "growth",
    mode: "public",
    owner: "user",
    slug: "growth",
    page: "https://example.com/dash",
    password_hash: null,
    has_password: false,
    created_by: "u1",
    created_at: "2026-10-18T00:00:00.000Z",
    updated_at: "2026-10-18T00:00:00.000Z",
    ...over,
  };
}

// A query builder bound to a single table; chains like `.select().eq().maybeSingle()` resolve to
// whatever the test set on `from` for that table. `eq` records its arguments so a test can assert
// on the lookup columns (owner, created_by, org_id, slug).
export function fromTable(
  table: string,
  rows: { share?: unknown; membership?: unknown; profile?: unknown; org?: unknown } = {},
  errors: Record<string, { message: string }> = {},
) {
  const eqCalls: { column: string; value: unknown }[] = [];
  const make = (): Record<string, unknown> => {
    const builder: Record<string, unknown> = {};
    const chainMethods = ["select", "order", "limit"];
    for (const m of chainMethods) builder[m] = vi.fn(() => make());
    builder.eq = vi.fn((column: string, value: unknown) => {
      eqCalls.push({ column, value });
      return make();
    });
    builder.maybeSingle = vi.fn(() => {
      if (table === "cloud_app_shares") return Promise.resolve({ data: rows.share ?? null, error: errors.cloud_app_shares ?? null });
      if (table === "org_memberships") return Promise.resolve({ data: rows.membership ?? null, error: errors.org_memberships ?? null });
      if (table === "profiles") return Promise.resolve({ data: rows.profile ?? null, error: errors.profiles ?? null });
      if (table === "orgs") return Promise.resolve({ data: rows.org ?? null, error: errors.orgs ?? null });
      return Promise.resolve({ data: null, error: null });
    });
    builder.insert = vi.fn(() => Promise.resolve({ error: null }));
    return builder;
  };
  const root = make();
  (root as { __eqCalls: typeof eqCalls }).__eqCalls = eqCalls;
  return root as Record<string, unknown> & { __eqCalls: typeof eqCalls };
}

export function serviceWith(tables: Record<string, ReturnType<typeof fromTable>>): SupabaseClient {
  return { from: (table: string) => tables[table] ?? fromTable(table, {}) } as unknown as SupabaseClient;
}
