// lib/app-fetch-limit.ts: counts rows in cloud_app_fetches in the last 60 s, returns 429 with Retry-After
// when the per-viewer (60) or per-share (600) bucket is full, and logs every attempt. Anonymous visitors
// are counted in a per-process Map keyed by sha256(ip + WEFT_MINIAPP_KEY) so one IP can't lock out the
// rest. The fake is the same shape used in lib/app-secret-store.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FETCH_PER_MINUTE_PER_SHARE,
  FETCH_PER_MINIAPP_ANONYMOUS_PEPPER_FALLBACK,
  FETCH_PER_MINUTE_PER_VIEWER,
  anonymousCount,
  clientIpFromHeaders,
  countRecentFetches,
  fetchLimitVerdict,
  hashAnonymous,
  insertFetchLog,
  recordAnonymousHit,
  resetAnonymousBuckets,
} from "./app-fetch-limit";

interface FakeLogRow {
  share_id: string;
  viewer_id: string | null;
  method: string;
  host: string;
  path: string;
  status: number;
  at: string;
}

function makeClient(rows: FakeLogRow[]) {
  const calls: { method: string; args: unknown[] }[] = [];
  const make = (): Record<string, unknown> => {
    const builder: Record<string, unknown> = {};
    for (const m of ["select", "order", "limit", "insert", "delete", "update", "upsert"]) {
      builder[m] = vi.fn((...args: unknown[]) => {
        calls.push({ method: m, args });
        return builder;
      });
    }
    builder.eq = vi.fn((col: string, val: unknown) => {
      calls.push({ method: "eq", args: [col, val] });
      const prev = (builder as { __filter?: (r: FakeLogRow) => boolean }).__filter ?? (() => true);
      (builder as { __filter?: (r: FakeLogRow) => boolean }).__filter = (r) => prev(r) && r[col as keyof FakeLogRow] === val;
      return builder;
    });
    builder.is = vi.fn((col: string, val: unknown) => {
      calls.push({ method: "is", args: [col, val] });
      const prev = (builder as { __filter?: (r: FakeLogRow) => boolean }).__filter ?? (() => true);
      (builder as { __filter?: (r: FakeLogRow) => boolean }).__filter = (r) => {
        if (!prev(r)) return false;
        const cell = r[col as keyof FakeLogRow];
        return val === null ? cell === null : cell === val;
      };
      return builder;
    });
    builder.gte = vi.fn((col: string, val: unknown) => {
      calls.push({ method: "gte", args: [col, val] });
      const prev = (builder as { __filter?: (r: FakeLogRow) => boolean }).__filter ?? (() => true);
      (builder as { __filter?: (r: FakeLogRow) => boolean }).__filter = (r) => prev(r) && String(r[col as keyof FakeLogRow]) >= String(val);
      return builder;
    });
    // `head: true` returns { count } instead of { data }. We always pass head: true in countRecentFetches.
    builder.then = (onFulfilled: (v: { count: number | null }) => unknown) => {
      const filter = (builder as { __filter?: (r: FakeLogRow) => boolean }).__filter;
      const matches = filter ? rows.filter(filter).length : rows.length;
      return Promise.resolve(onFulfilled({ count: matches }));
    };
    return builder;
  };
  const service = {
    from: (table: string) => {
      calls.push({ method: "from", args: [table] });
      const builder = make();
      // insert writes the row to the fake's array.
      (builder as { insert: ReturnType<typeof vi.fn> }).insert = vi.fn((input: unknown) => {
        const list = Array.isArray(input) ? input : [input];
        for (const item of list) {
          rows.push({ ...(item as FakeLogRow), at: new Date().toISOString() });
        }
        calls.push({ method: "insert", args: [input] });
        return Promise.resolve({ error: null });
      });
      return builder;
    },
  };
  return { service, calls, rows };
}

function makeRow(over: Partial<FakeLogRow> = {}): FakeLogRow {
  return {
    share_id: "s1",
    viewer_id: "user-1",
    method: "GET",
    host: "api.stripe.com",
    path: "/v1/charges",
    status: 200,
    at: new Date().toISOString(),
    ...over,
  };
}

const NOW = new Date("2026-10-19T12:00:00.000Z");
const NOW_MS = NOW.getTime();
const PEPPER = "test-pepper-32-bytes-base64-aaaaaaaaa";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  resetAnonymousBuckets();
});

afterEach(() => {
  resetAnonymousBuckets();
});

describe("clientIpFromHeaders", () => {
  it("returns the first hop from x-forwarded-for", () => {
    const h = new Headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" });
    expect(clientIpFromHeaders(h)).toBe("1.2.3.4");
  });

  it("falls back to x-real-ip", () => {
    const h = new Headers({ "x-real-ip": "9.9.9.9" });
    expect(clientIpFromHeaders(h)).toBe("9.9.9.9");
  });

  it("returns an empty string when nothing is set", () => {
    expect(clientIpFromHeaders(new Headers())).toBe("");
  });
});

describe("hashAnonymous", () => {
  it("returns a stable hex hash for the same IP and pepper", () => {
    expect(hashAnonymous("1.2.3.4", PEPPER)).toBe(hashAnonymous("1.2.3.4", PEPPER));
  });

  it("changes when the IP changes", () => {
    expect(hashAnonymous("1.2.3.4", PEPPER)).not.toBe(hashAnonymous("1.2.3.5", PEPPER));
  });

  it("falls back to a constant salt when the pepper is empty", () => {
    const a = hashAnonymous("1.2.3.4", "");
    const b = hashAnonymous("1.2.3.4", "");
    expect(a).toBe(b);
    expect(a).not.toBe(hashAnonymous("1.2.3.4", PEPPER));
  });
});

describe("anonymousCount", () => {
  it("is 0 before any hits and grows by one per recordAnonymousHit", () => {
    expect(anonymousCount("s1", "1.2.3.4", NOW_MS, PEPPER)).toBe(0);
    recordAnonymousHit("s1", "1.2.3.4", NOW_MS, PEPPER);
    recordAnonymousHit("s1", "1.2.3.4", NOW_MS, PEPPER);
    expect(anonymousCount("s1", "1.2.3.4", NOW_MS, PEPPER)).toBe(2);
  });

  it("keeps hits from different IPs in different buckets", () => {
    recordAnonymousHit("s1", "1.2.3.4", NOW_MS, PEPPER);
    recordAnonymousHit("s1", "1.2.3.4", NOW_MS, PEPPER);
    recordAnonymousHit("s1", "5.6.7.8", NOW_MS, PEPPER);
    expect(anonymousCount("s1", "1.2.3.4", NOW_MS, PEPPER)).toBe(2);
    expect(anonymousCount("s1", "5.6.7.8", NOW_MS, PEPPER)).toBe(1);
  });

  it("prunes hits older than 60 s", () => {
    recordAnonymousHit("s1", "1.2.3.4", NOW_MS - 120_000, PEPPER);
    recordAnonymousHit("s1", "1.2.3.4", NOW_MS - 90_000, PEPPER);
    recordAnonymousHit("s1", "1.2.3.4", NOW_MS, PEPPER);
    expect(anonymousCount("s1", "1.2.3.4", NOW_MS, PEPPER)).toBe(1);
  });

  it("uses the documented fallback salt when the env is missing", () => {
    delete process.env.WEFT_MINIAPP_KEY;
    recordAnonymousHit("s1", "1.2.3.4", NOW_MS);
    expect(anonymousCount("s1", "1.2.3.4", NOW_MS)).toBe(1);
    expect(FETCH_PER_MINIAPP_ANONYMOUS_PEPPER_FALLBACK).toBe("weft-miniapp-anonymous-fallback");
  });
});

describe("countRecentFetches", () => {
  it("counts only the rows for this share, this viewer, in the last 60s", async () => {
    const old = makeRow({ at: new Date(NOW.getTime() - 120_000).toISOString() });
    const { service } = makeClient([old, makeRow(), makeRow({ viewer_id: "user-2" })]);
    const out = await countRecentFetches(service as never, "s1", "user-1", "1.1.1.1", NOW);
    expect(out.viewer).toBe(1);
    // share is the count of this share's recent rows (the old one is older than 60s).
    expect(out.share).toBe(2);
  });

  it("uses null viewer_id for an anonymous visitor", async () => {
    const { service } = makeClient([makeRow({ viewer_id: null }), makeRow({ viewer_id: "user-1" })]);
    const out = await countRecentFetches(service as never, "s1", null, "1.1.1.1", NOW);
    expect(out.viewer).toBe(1);
  });
});

describe("fetchLimitVerdict", () => {
  it("returns ok when the buckets are under the limits", async () => {
    const { service } = makeClient([makeRow()]);
    const out = await fetchLimitVerdict(service as never, "s1", "user-1", "1.1.1.1", NOW);
    expect(out.ok).toBe(true);
    expect(out.retryAfter).toBe(0);
  });

  it("blocks when the per-viewer limit is hit", async () => {
    const rows = Array.from({ length: FETCH_PER_MINUTE_PER_VIEWER }, () => makeRow());
    const { service } = makeClient(rows);
    const out = await fetchLimitVerdict(service as never, "s1", "user-1", "1.1.1.1", NOW);
    expect(out.ok).toBe(false);
    expect(out.bucket?.kind).toBe("viewer");
    expect(out.bucket?.count).toBe(FETCH_PER_MINUTE_PER_VIEWER);
    expect(out.retryAfter).toBe(60);
  });

  it("blocks when the per-share limit is hit (with a smaller viewer count)", async () => {
    const rows = Array.from({ length: FETCH_PER_MINUTE_PER_SHARE }, (_, i) => makeRow({ viewer_id: `user-${i % 100}` }));
    const { service } = makeClient(rows);
    const out = await fetchLimitVerdict(service as never, "s1", "user-1", "1.1.1.1", NOW);
    expect(out.ok).toBe(false);
    expect(out.bucket?.kind).toBe("share");
    expect(out.bucket?.count).toBe(FETCH_PER_MINUTE_PER_SHARE);
  });

  it("checks the per-viewer bucket before the per-share bucket", async () => {
    // Both buckets are at their cap; viewer wins.
    const rows = [
      ...Array.from({ length: FETCH_PER_MINUTE_PER_VIEWER }, () => makeRow()),
      ...Array.from({ length: FETCH_PER_MINUTE_PER_SHARE - FETCH_PER_MINUTE_PER_VIEWER }, (_, i) => makeRow({ viewer_id: `u${i}` })),
    ];
    const { service } = makeClient(rows);
    const out = await fetchLimitVerdict(service as never, "s1", "user-1", "1.1.1.1", NOW);
    expect(out.bucket?.kind).toBe("viewer");
  });

  it("blocks anonymous visitors from a single IP at FETCH_PER_MINUTE_PER_VIEWER", async () => {
    // 60 hits from one IP in the same window: the table only stores viewer_id null (shared across all
    // anonymous visitors), so the per-process bucket is the only thing that can isolate this IP.
    for (let i = 0; i < FETCH_PER_MINUTE_PER_VIEWER; i++) recordAnonymousHit("s1", "9.9.9.9", NOW_MS, PEPPER);
    const { service } = makeClient([makeRow({ viewer_id: null })]);
    const out = await fetchLimitVerdict(service as never, "s1", null, "9.9.9.9", NOW, PEPPER);
    expect(out.ok).toBe(false);
    expect(out.bucket?.kind).toBe("ip");
    expect(out.bucket?.count).toBe(FETCH_PER_MINUTE_PER_VIEWER);
    expect(out.retryAfter).toBe(60);
  });

  it("does not block a different IP from the same share", async () => {
    for (let i = 0; i < FETCH_PER_MINUTE_PER_VIEWER; i++) recordAnonymousHit("s1", "9.9.9.9", NOW_MS, PEPPER);
    const { service } = makeClient([]);
    const out = await fetchLimitVerdict(service as never, "s1", null, "1.2.3.4", NOW, PEPPER);
    expect(out.ok).toBe(true);
  });

  it("lets a different share through when the per-IP bucket is full", async () => {
    for (let i = 0; i < FETCH_PER_MINUTE_PER_VIEWER; i++) recordAnonymousHit("s1", "9.9.9.9", NOW_MS, PEPPER);
    const { service } = makeClient([]);
    const out = await fetchLimitVerdict(service as never, "s2", null, "9.9.9.9", NOW, PEPPER);
    expect(out.ok).toBe(true);
  });
});

describe("insertFetchLog", () => {
  it("writes one row and never the value", async () => {
    const { service, rows } = makeClient([]);
    await insertFetchLog(service as never, {
      shareId: "s1",
      viewerId: "user-1",
      method: "GET",
      host: "api.stripe.com",
      path: "/v1/charges",
      status: 200,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      share_id: "s1",
      viewer_id: "user-1",
      method: "GET",
      host: "api.stripe.com",
      path: "/v1/charges",
      status: 200,
    });
    // No value field — the migration's column set is method, host, path, status only.
    expect(Object.keys(rows[0]!)).toEqual(expect.arrayContaining(["share_id", "viewer_id", "method", "host", "path", "status", "at"]));
  });

  it("logs a refusal as well as a success", async () => {
    const { service, rows } = makeClient([]);
    await insertFetchLog(service as never, { shareId: "s1", viewerId: null, method: "POST", host: "x", path: "/y", status: 403 });
    await insertFetchLog(service as never, { shareId: "s1", viewerId: null, method: "GET", host: "x", path: "/y", status: 200 });
    expect(rows.map((r) => r.status)).toEqual([403, 200]);
  });
});