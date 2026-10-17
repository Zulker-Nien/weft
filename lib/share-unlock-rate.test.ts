// lib/share-unlock-rate.ts: the per-(ip_hash, share_id) bucket that replaces the in-memory rate
// limit at app/api/s/[id]/unlock. The helper is small enough to cover here: window reset, bump,
// over-the-limit denial, and the fail-open behavior on a Supabase error.
import { describe, expect, it } from "vitest";
import { checkAndRecord, hashIp, RATE_MAX, RATE_WINDOW_MS } from "./share-unlock-rate";

interface RowState {
  count: number;
  first_at: string;
}

function makeService(rows: Map<string, RowState>) {
  const keyOf = (ipHash: string, shareId: string) => `${ipHash}|${shareId}`;
  return {
    from(table: string) {
      if (table !== "share_unlock_attempts") throw new Error(`unexpected table ${table}`);
      return {
        select() {
          return {
            eq(field: string, value: string) {
              const filters: { ip_hash?: string; share_id?: string } = {};
              filters[field as "ip_hash" | "share_id"] = value;
              return {
                eq(field2: string, value2: string) {
                  filters[field2 as "ip_hash" | "share_id"] = value2;
                  return {
                    maybeSingle() {
                      const row = rows.get(keyOf(filters.ip_hash ?? "", filters.share_id ?? ""));
                      return Promise.resolve({ data: row ?? null, error: null });
                    },
                  };
                },
                maybeSingle() {
                  const row = rows.get(keyOf(filters.ip_hash ?? "", filters.share_id ?? ""));
                  return Promise.resolve({ data: row ?? null, error: null });
                },
              };
            },
          };
        },
        upsert(values: { ip_hash: string; share_id: string; count: number; first_at: string }) {
          rows.set(keyOf(values.ip_hash, values.share_id), { count: values.count, first_at: values.first_at });
          return Promise.resolve({ error: null });
        },
        update(values: { count: number }) {
          return {
            eq(field: string, value: string) {
              const filters: { ip_hash?: string; share_id?: string } = {};
              filters[field as "ip_hash" | "share_id"] = value;
              return {
                eq(field2: string, value2: string) {
                  filters[field2 as "ip_hash" | "share_id"] = value2;
                  return Promise.resolve((() => {
                    const key = keyOf(filters.ip_hash ?? "", filters.share_id ?? "");
                    const row = rows.get(key);
                    if (!row) return { error: { message: "no row" } };
                    rows.set(key, { ...row, count: values.count });
                    return { error: null };
                  })());
                },
              };
            },
          };
        },
      };
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

  it("fails open when the read throws", async () => {
    const service = {
      from() {
        return {
          select() {
            return {
              eq() {
                return {
                  eq() {
                    return { maybeSingle: () => Promise.resolve({ data: null, error: { message: "down" } }) };
                  },
                };
              },
            };
          },
        };
      },
    };
    const verdict = await checkAndRecord(service as never, ipHash, shareId, now);
    expect(verdict.allowed).toBe(true);
  });

  it("fails open when the window-reset upsert throws", async () => {
    const service = {
      from() {
        return {
          select() {
            return { eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) };
          },
          upsert() {
            return Promise.resolve({ error: { message: "down" } });
          },
        };
      },
    };
    const verdict = await checkAndRecord(service as never, ipHash, shareId, now);
    expect(verdict.allowed).toBe(true);
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
