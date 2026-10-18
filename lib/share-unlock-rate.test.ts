// lib/share-unlock-rate.ts: the per-(ip_hash, share_id) bucket that replaces the in-memory rate
// limit at app/api/s/[id]/unlock. The helper is small enough to cover here: window reset, bump,
// over-the-limit denial, the race the single round trip closes, and fail-open on a Supabase error.
import { describe, expect, it } from "vitest";
import { checkAndRecord, hashIp, RATE_MAX, RATE_WINDOW_MS } from "./share-unlock-rate";

interface RowState {
  count: number;
  first_at: string;
}

interface BumpArgs {
  p_ip_hash: string;
  p_share_id: string;
  p_now: string;
  p_window_ms: number;
  p_max: number;
}

// A stand-in for public.share_unlock_bump (supabase/migrations/20261018045842_share_unlock_bump.sql):
// the same window roll and capped bump, applied in one step per call the way the row lock serializes
// them. `from()` throws, so a regression back to a select + update fails every test here.
function makeService(rows: Map<string, RowState>) {
  return {
    from(table: string) {
      throw new Error(`checkAndRecord must not read or write ${table} directly`);
    },
    async rpc(fn: string, args: BumpArgs) {
      if (fn !== "share_unlock_bump") throw new Error(`unexpected rpc ${fn}`);
      await Promise.resolve();
      const key = `${args.p_ip_hash}|${args.p_share_id}`;
      const now = Date.parse(args.p_now);
      const row = rows.get(key);
      const rolled = !row || Date.parse(row.first_at) <= now - args.p_window_ms;
      const next = rolled
        ? { count: 1, first_at: args.p_now }
        : { count: Math.min(row.count + 1, args.p_max + 1), first_at: row.first_at };
      rows.set(key, next);
      return { data: [{ allowed: next.count <= args.p_max, first_at: next.first_at }], error: null };
    },
  };
}

describe("checkAndRecord", () => {
  const now = 1_700_000_000_000;
  const ipHash = "h1";
  const shareId = "shareA";

  it("allows the first attempt and seeds the bucket", async () => {
    const rows = new Map<string, RowState>();
    const service = makeService(rows);
    const verdict = await checkAndRecord(service as never, ipHash, shareId, now);
    expect(verdict.allowed).toBe(true);
    expect(verdict.windowResetAt).toBe(now + RATE_WINDOW_MS);
    expect(rows.get(`${ipHash}|${shareId}`)?.count).toBe(1);
  });

  it("bumps the count on every attempt in the same window", async () => {
    const rows = new Map<string, RowState>([[`${ipHash}|${shareId}`, { count: 1, first_at: new Date(now).toISOString() }]]);
    const service = makeService(rows);
    for (let i = 0; i < RATE_MAX - 1; i++) {
      const verdict = await checkAndRecord(service as never, ipHash, shareId, now + 1000);
      expect(verdict.allowed).toBe(true);
    }
    expect(rows.get(`${ipHash}|${shareId}`)?.count).toBe(RATE_MAX);
  });

  it("denies past the max and returns the window's reset time", async () => {
    const firstAt = new Date(now).toISOString();
    const rows = new Map<string, RowState>([[`${ipHash}|${shareId}`, { count: RATE_MAX, first_at: firstAt }]]);
    const service = makeService(rows);
    const verdict = await checkAndRecord(service as never, ipHash, shareId, now + 1000);
    expect(verdict.allowed).toBe(false);
    expect(verdict.windowResetAt).toBe(Date.parse(firstAt) + RATE_WINDOW_MS);
  });

  it("rolls the window forward once the original first_at has aged out", async () => {
    const rows = new Map<string, RowState>([[`${ipHash}|${shareId}`, { count: RATE_MAX, first_at: new Date(now - RATE_WINDOW_MS - 1).toISOString() }]]);
    const service = makeService(rows);
    const verdict = await checkAndRecord(service as never, ipHash, shareId, now);
    expect(verdict.allowed).toBe(true);
    expect(rows.get(`${ipHash}|${shareId}`)?.count).toBe(1);
  });

  it("lets at most RATE_MAX of many concurrent attempts through", async () => {
    const rows = new Map<string, RowState>();
    const service = makeService(rows);
    const verdicts = await Promise.all(
      Array.from({ length: RATE_MAX * 3 }, () => checkAndRecord(service as never, ipHash, shareId, now)),
    );
    expect(verdicts.filter((v) => v.allowed)).toHaveLength(RATE_MAX);
    expect(rows.get(`${ipHash}|${shareId}`)?.count).toBe(RATE_MAX + 1);
  });

  it("fails open when the rpc errors", async () => {
    const service = { rpc: () => Promise.resolve({ data: null, error: { message: "down" } }) };
    const verdict = await checkAndRecord(service as never, ipHash, shareId, now);
    expect(verdict).toEqual({ allowed: true, windowResetAt: now + RATE_WINDOW_MS });
  });

  it("fails open when the rpc returns no row", async () => {
    const service = { rpc: () => Promise.resolve({ data: [], error: null }) };
    const verdict = await checkAndRecord(service as never, ipHash, shareId, now);
    expect(verdict.allowed).toBe(true);
  });

  it("reads a single-object rpc result too", async () => {
    const firstAt = new Date(now).toISOString();
    const service = { rpc: () => Promise.resolve({ data: { allowed: false, first_at: firstAt }, error: null }) };
    const verdict = await checkAndRecord(service as never, ipHash, shareId, now + 5);
    expect(verdict).toEqual({ allowed: false, windowResetAt: now + RATE_WINDOW_MS });
  });
});

describe("hashIp", () => {
  it("is a stable 64-char hex digest of ip+pepper", async () => {
    const a = await hashIp("1.2.3.4", "pepper");
    const b = await hashIp("1.2.3.4", "pepper");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when the ip changes", async () => {
    const a = await hashIp("1.2.3.4", "pepper");
    const b = await hashIp("1.2.3.5", "pepper");
    expect(a).not.toBe(b);
  });

  it("changes when the pepper changes", async () => {
    const a = await hashIp("1.2.3.4", "pepperA");
    const b = await hashIp("1.2.3.4", "pepperB");
    expect(a).not.toBe(b);
  });

  it("uses Web Crypto, not a custom algo (sanity)", async () => {
    // If someone replaces hashIp with a non-cryptographic one, this fingerprint would change.
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("1.2.3.4|pepper"));
    const expected = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    expect(await hashIp("1.2.3.4", "pepper")).toBe(expected);
  });
});
