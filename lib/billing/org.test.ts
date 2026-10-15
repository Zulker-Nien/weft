import { beforeEach, describe, expect, it, vi } from "vitest";
import { orgForUser } from "./org";

// lib/billing/org.ts: current org → fallback owner membership → null. The supabase query builder is mocked
// through a small fake that records the chain and answers with whatever the test set up.

type Reply = { data: unknown; error: null };

class FakeChain {
  filters: Array<[string, unknown]>;
  orderBy: { column: string; opts: { ascending?: boolean } } | null = null;
  limitN: number | null = null;
  private reply: () => Reply;
  constructor(reply: () => Reply) {
    this.filters = [];
    this.reply = reply;
  }
  // The fake ignores which columns are asked for; the scripted replies decide the rows.
  select(): this {
    return this;
  }
  eq(column: string, value: unknown): this {
    this.filters.push([column, value]);
    return this;
  }
  order(column: string, opts: { ascending?: boolean } = {}): this {
    this.orderBy = { column, opts };
    return this;
  }
  limit(n: number): this {
    this.limitN = n;
    return this;
  }
  // The terminal operator orgForUser uses.
  maybeSingle() {
    return Promise.resolve(this.reply());
  }
}

interface ScriptedCall {
  table: string;
  reply: () => Reply;
}

function fakeService(plan: ScriptedCall[]): { from: ReturnType<typeof vi.fn>; calls: { table: string; filters: Array<[string, unknown]>; order: { column: string; opts: { ascending?: boolean } } | null; limitN: number | null }[] } {
  const calls: { table: string; filters: Array<[string, unknown]>; order: { column: string; opts: { ascending?: boolean } } | null; limitN: number | null }[] = [];
  let i = 0;
  const from = vi.fn((table: string) => {
    const scripted = plan[i++] ?? { table, reply: () => ({ data: null, error: null }) };
    expect(scripted.table).toBe(table);
    const chain = new FakeChain(scripted.reply);
    const original = chain.maybeSingle.bind(chain);
    chain.maybeSingle = () => {
      calls.push({ table, filters: chain.filters.slice(), order: chain.orderBy, limitN: chain.limitN });
      return original();
    };
    return chain;
  });
  return { from, calls };
}

beforeEach(() => {
  vi.useRealTimers();
});

describe("orgForUser", () => {
  it("returns the active org when the user is still a member", async () => {
    const { from, calls } = fakeService([
      { table: "profiles", reply: () => ({ data: { current_org_id: "org-1" }, error: null }) },
      { table: "orgs", reply: () => ({ data: { id: "org-1", slug: "ada", name: "Ada" }, error: null }) },
      { table: "org_memberships", reply: () => ({ data: { org_id: "org-1" }, error: null }) },
    ]);
    const org = await orgForUser({ from } as never, "user-1");
    expect(org).toEqual({ id: "org-1", slug: "ada", name: "Ada" });
    expect(from).toHaveBeenCalledTimes(3);
    expect(calls[0]!.filters).toEqual([["id", "user-1"]]);
    expect(calls[1]!.filters).toEqual([["id", "org-1"]]);
    expect(calls[2]!.filters).toEqual([["org_id", "org-1"], ["user_id", "user-1"]]);
  });

  it("falls back to the user's oldest owner membership when the active one is gone", async () => {
    const { from, calls } = fakeService([
      { table: "profiles", reply: () => ({ data: { current_org_id: "org-stale" }, error: null }) },
      { table: "orgs", reply: () => ({ data: null, error: null }) },
      { table: "org_memberships", reply: () => ({ data: { org_id: "org-2" }, error: null }) },
      { table: "orgs", reply: () => ({ data: { id: "org-2", slug: "ada-2", name: "Ada 2" }, error: null }) },
    ]);
    const org = await orgForUser({ from } as never, "user-1");
    expect(org).toEqual({ id: "org-2", slug: "ada-2", name: "Ada 2" });
    expect(calls[2]!.filters).toEqual([["user_id", "user-1"], ["role", "owner"]]);
    expect(calls[2]!.order).toEqual({ column: "created_at", opts: { ascending: true } });
    expect(calls[2]!.limitN).toBe(1);
  });

  it("returns null when the user has no workspace", async () => {
    const { from } = fakeService([
      { table: "profiles", reply: () => ({ data: { current_org_id: null }, error: null }) },
      { table: "org_memberships", reply: () => ({ data: null, error: null }) },
    ]);
    expect(await orgForUser({ from } as never, "user-1")).toBeNull();
    expect(from).toHaveBeenCalledTimes(2);
  });

  it("falls through when the active org exists but the user is no longer a member", async () => {
    const { from, calls } = fakeService([
      { table: "profiles", reply: () => ({ data: { current_org_id: "org-1" }, error: null }) },
      { table: "orgs", reply: () => ({ data: { id: "org-1", slug: "ada", name: "Ada" }, error: null }) },
      { table: "org_memberships", reply: () => ({ data: null, error: null }) },
      { table: "org_memberships", reply: () => ({ data: { org_id: "org-2" }, error: null }) },
      { table: "orgs", reply: () => ({ data: { id: "org-2", slug: "ada-2", name: "Ada 2" }, error: null }) },
    ]);
    const org = await orgForUser({ from } as never, "user-1");
    expect(org).toEqual({ id: "org-2", slug: "ada-2", name: "Ada 2" });
    expect(calls[2]!.filters).toEqual([["org_id", "org-1"], ["user_id", "user-1"]]);
  });
});