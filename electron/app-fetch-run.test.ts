// The fetch executor for hosted mini apps: DNS check, plan, fill, fetch, mask, return. The
// tests inject fetch and dns.lookup so nothing reaches the network. The runner is what
// planFetch protects, so the test focuses on its own rules: timeouts, byte caps, redirect
// handling, encoding, masking and the response header allowlist.

import { describe, expect, it, vi } from "vitest";
import { runFetch } from "./app-fetch-run.cjs";
import { parsePolicy } from "./app-fetch-policy.cjs";

const policy = parsePolicy({
  secrets: {
    STRIPE_KEY: { hosts: ["api.stripe.com"], methods: ["GET"], paths: ["/v1/charges"] },
    OPENAI: { hosts: ["api.openai.com"], methods: ["POST"], paths: ["/v1/responses"] },
  },
});

type Lookup = (host: string, opts: { all: true }, cb: (err: unknown, addresses: { address: string; family: number }[] | null) => void) => void;

// Builds a tiny lookup that ignores the host and returns one of: public, private, mixed, failing.
function makeLookup(kind: "public" | "private" | "mixed" | "fail"): Lookup {
  return (_host, _opts, cb) => {
    if (kind === "fail") { cb(new Error("no DNS"), null); return; }
    if (kind === "public") { cb(null, [{ address: "8.8.8.8", family: 4 }]); return; }
    if (kind === "private") { cb(null, [{ address: "127.0.0.1", family: 4 }]); return; }
    cb(null, [{ address: "8.8.8.8", family: 4 }, { address: "127.0.0.1", family: 4 }]);
  };
}

const lookupOk = makeLookup("public");
const lookupPrivate = makeLookup("private");
const lookupMixed = makeLookup("mixed");
const lookupFails = makeLookup("fail");

// Builds a fake fetch response with the bytes the test wants, the content type, and a header
// map for the response. status defaults to 200.
function makeResponse({ status = 200, contentType, body = "", headers = {} }: { status?: number; contentType?: string; body?: string | Buffer; headers?: Record<string, string> } = {}) {
  const bytes = typeof body === "string" ? Buffer.from(body, "utf8") : body;
  const headerMap = new Map<string, string>();
  for (const [k, v] of Object.entries(headers)) headerMap.set(k.toLowerCase(), v);
  if (contentType !== undefined) headerMap.set("content-type", contentType);
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get: (name: string) => headerMap.get(name.toLowerCase()) ?? null,
      forEach: (cb: (value: string, name: string) => void) => {
        for (const [k, v] of headerMap.entries()) cb(v, k);
      },
    },
    body: {
      getReader: () => {
        const chunk = new Uint8Array(bytes);
        let consumed = false;
        return {
          read: () => {
            if (consumed) return Promise.resolve({ value: undefined, done: true });
            consumed = true;
            return Promise.resolve({ value: chunk, done: false });
          },
          cancel: () => Promise.resolve(),
        };
      },
    },
    arrayBuffer: () => Promise.resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
  };
}

// The runner's opts with every field but `request`, which each test supplies through `overrides`.
// The return type is runFetch's own opts type: spreading a Partial over the base would otherwise
// leave every field optional and the object unassignable at the runFetch call.
type RunOpts = Parameters<typeof runFetch>[0];
const baseOpts = (overrides: Partial<RunOpts> = {}): RunOpts => ({
  policy,
  getValues: (names: string[]) => Promise.resolve(Object.fromEntries(names.map((n) => [n, `VALUE_${n}`]))),
  fetch: vi.fn(),
  lookup: lookupOk,
  request: { url: "https://api.stripe.com/v1/charges", method: "GET", headers: {} },
  ...overrides,
});

describe("runFetch refusal paths", () => {
  it("refuses a request that planFetch refused (403)", async () => {
    const fetchMock = vi.fn();
    await expect(runFetch(baseOpts({ fetch: fetchMock, request: { url: "https://example.com/", method: "GET" } }))).rejects.toMatchObject({ status: 403 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a missing secret (409)", async () => {
    const fetchMock = vi.fn();
    await expect(runFetch(baseOpts({
      fetch: fetchMock,
      getValues: () => Promise.resolve({} as Record<string, string>),
      request: { url: "https://api.stripe.com/v1/charges", method: "GET", headers: { authorization: "Bearer {{secret:STRIPE_KEY}}" } },
    }))).rejects.toMatchObject({ status: 409 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  const dnsRefusalCases: Array<[string, Lookup, number]> = [
    ["a private address", lookupPrivate, 403],
    ["a public + private mix", lookupMixed, 403],
    ["an error", lookupFails, 403],
  ];
  for (const [name, lookup, status] of dnsRefusalCases) {
    it(`refuses when DNS returns ${name} (${status})`, async () => {
      const fetchMock = vi.fn();
      await expect(runFetch(baseOpts({ fetch: fetchMock, lookup, request: { url: "https://api.stripe.com/v1/charges", method: "GET" } }))).rejects.toMatchObject({ status });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  }
});

describe("runFetch request shape", () => {
  it("sends the method, headers (with placeholders filled), body and a manual redirect", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeResponse({ contentType: "application/json", body: "{}" }));
    await runFetch(baseOpts({
      fetch: fetchMock,
      request: { url: "https://api.stripe.com/v1/charges?limit=10", method: "GET", headers: { authorization: "Bearer {{secret:STRIPE_KEY}}", "x-trace": "{{secret:STRIPE_KEY}}" } },
    }));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.stripe.com/v1/charges?limit=10");
    expect(init.method).toBe("GET");
    expect(init.redirect).toBe("manual");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer VALUE_STRIPE_KEY");
    expect((init.headers as Record<string, string>)["x-trace"]).toBe("VALUE_STRIPE_KEY");
    expect(init.signal).toBeDefined();
  });

  it("asks getValues exactly once and only for the names planFetch found", async () => {
    const getValues = vi.fn().mockResolvedValue({ STRIPE_KEY: "VALUE_STRIPE_KEY" });
    const fetchMock = vi.fn().mockResolvedValue(makeResponse({ contentType: "application/json", body: "{}" }));
    await runFetch(baseOpts({
      getValues,
      fetch: fetchMock,
      request: { url: "https://api.stripe.com/v1/charges", method: "GET", headers: { authorization: "Bearer {{secret:STRIPE_KEY}}" } },
    }));
    expect(getValues).toHaveBeenCalledWith(["STRIPE_KEY"]);
  });

  it("does not call getValues when the request has no placeholders", async () => {
    const getValues = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue(makeResponse({ contentType: "application/json", body: "{}" }));
    await runFetch(baseOpts({ getValues, fetch: fetchMock, request: { url: "https://api.stripe.com/v1/charges", method: "GET" } }));
    expect(getValues).not.toHaveBeenCalled();
  });
});

describe("runFetch response", () => {
  it("returns utf8 for a textual content type and masks the echoed secret in the body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeResponse({ contentType: "application/json", body: '{"id":"ch_1","client_secret":"VALUE_STRIPE_KEY"}' }));
    const result = await runFetch(baseOpts({
      fetch: fetchMock,
      request: { url: "https://api.stripe.com/v1/charges", method: "GET", headers: { authorization: "Bearer {{secret:STRIPE_KEY}}" } },
    }));
    expect(result.status).toBe(200);
    expect(result.ok).toBe(true);
    expect(result.bodyEncoding).toBe("utf8");
    expect(result.body).toBe('{"id":"ch_1","client_secret":"‹STRIPE_KEY›"}');
  });

  it("returns base64 for an image content type", async () => {
    // 1x1 PNG (89 bytes), the smallest possible valid PNG.
    const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63f8cfc0c0c0c0c8c0c8c0c8000100050001a1f6e690000000049454e44ae426082", "hex");
    const fetchMock = vi.fn().mockResolvedValue(makeResponse({ contentType: "image/png", body: png }));
    const result = await runFetch(baseOpts({ fetch: fetchMock, request: { url: "https://api.stripe.com/v1/charges", method: "GET" } }));
    expect(result.bodyEncoding).toBe("base64");
    expect(Buffer.from(result.body, "base64").equals(png)).toBe(true);
  });

  it("returns utf8 for a missing content type when the bytes decode as utf8", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeResponse({ body: "hello world" }));
    const result = await runFetch(baseOpts({ fetch: fetchMock, request: { url: "https://api.stripe.com/v1/charges", method: "GET" } }));
    expect(result.bodyEncoding).toBe("utf8");
    expect(result.body).toBe("hello world");
  });

  it("returns base64 for a missing content type whose bytes are not utf8", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeResponse({ body: Buffer.from([0xff, 0xfe, 0xfd, 0x00, 0x80, 0x90, 0xa0, 0xb0]) }));
    const result = await runFetch(baseOpts({ fetch: fetchMock, request: { url: "https://api.stripe.com/v1/charges", method: "GET" } }));
    expect(result.bodyEncoding).toBe("base64");
  });

  it("returns base64 for application/octet-stream even when bytes look like utf8", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeResponse({ contentType: "application/octet-stream", body: "hello" }));
    const result = await runFetch(baseOpts({ fetch: fetchMock, request: { url: "https://api.stripe.com/v1/charges", method: "GET" } }));
    expect(result.bodyEncoding).toBe("base64");
  });

  it("returns only the allowed response headers, lowercased", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeResponse({
      contentType: "application/json",
      body: "{}",
      headers: {
        "content-type": "application/json", "content-length": "2", "cache-control": "no-store",
        etag: '"abc"', "last-modified": "Wed, 21 Oct 2026 07:28:00 GMT",
        "x-ratelimit-remaining": "99", "x-ratelimit-reset": "60",
        "x-custom": "dropped", "set-cookie": "dropped", server: "dropped",
      },
    }));
    const result = await runFetch(baseOpts({ fetch: fetchMock, request: { url: "https://api.stripe.com/v1/charges", method: "GET" } }));
    expect(Object.keys(result.headers).sort()).toEqual([
      "cache-control", "content-length", "content-type", "etag", "last-modified",
      "x-ratelimit-remaining", "x-ratelimit-reset",
    ]);
    expect(result.headers["content-type"]).toBe("application/json");
    expect(result.headers["x-ratelimit-remaining"]).toBe("99");
  });

  it("masks a secret echoed in a returned header (Location)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeResponse({
      status: 302, contentType: "text/plain", body: "",
      headers: { location: "https://api.stripe.com/redirect?session=VALUE_STRIPE_KEY" },
    }));
    const result = await runFetch(baseOpts({
      fetch: fetchMock,
      request: { url: "https://api.stripe.com/v1/charges", method: "GET", headers: { authorization: "Bearer {{secret:STRIPE_KEY}}" } },
    }));
    expect(result.status).toBe(302);
    expect(result.headers.location).toBe("https://api.stripe.com/redirect?session=‹STRIPE_KEY›");
  });

  it("returns a 3xx as-is and does not follow it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeResponse({ status: 301, contentType: "text/plain", body: "", headers: { location: "https://other.example.com/v1/charges" } }));
    const result = await runFetch(baseOpts({ fetch: fetchMock, request: { url: "https://api.stripe.com/v1/charges", method: "GET" } }));
    expect(result.status).toBe(301);
    expect(result.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.redirect).toBe("manual");
  });

  it("throws 413 when the response body exceeds the byte cap", async () => {
    const big = Buffer.alloc(200, 0x41); // 200 'A's
    const fetchMock = vi.fn().mockResolvedValue(makeResponse({ contentType: "text/plain", body: big }));
    await expect(runFetch(baseOpts({ fetch: fetchMock, maxBytes: 100, request: { url: "https://api.stripe.com/v1/charges", method: "GET" } }))).rejects.toMatchObject({ status: 413 });
  });

  it("stops reading once the cap is hit and aborts the underlying reader", async () => {
    let cancelCount = 0;
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      headers: { get: () => "text/plain", forEach: () => {} },
      body: {
        getReader: () => {
          const queue: Uint8Array[] = [new Uint8Array(50), new Uint8Array(50), new Uint8Array(50)];
          let i = 0;
          return {
            read: () => {
              if (i >= queue.length) return Promise.resolve({ value: undefined, done: true });
              const value = queue[i++]!;
              return Promise.resolve({ value, done: false });
            },
            cancel: () => {
              cancelCount++;
              return Promise.resolve();
            },
          };
        },
      },
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    });
    await expect(runFetch(baseOpts({ fetch: fetchMock, maxBytes: 100, request: { url: "https://api.stripe.com/v1/charges", method: "GET" } }))).rejects.toMatchObject({ status: 413 });
    expect(cancelCount).toBeGreaterThan(0);
  });
});

describe("runFetch timeout and network failure", () => {
  it("aborts on timeout and throws 504", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
        return new Promise((_, reject) => {
          init.signal?.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        });
      });
      const promise = runFetch(baseOpts({ fetch: fetchMock, timeoutMs: 50, request: { url: "https://api.stripe.com/v1/charges", method: "GET" } }));
      // Attach handlers so the unhandled rejection doesn't escape.
      const caught: Promise<unknown> = promise.catch((err: unknown) => err);
      await vi.advanceTimersByTimeAsync(60);
      const result = await caught;
      expect(result).toBeInstanceOf(Error);
      expect((result as Error & { status?: number }).status).toBe(504);
    } finally {
      vi.useRealTimers();
    }
  });

  it("throws 502 when the underlying fetch rejects (not an abort)", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(runFetch(baseOpts({ fetch: fetchMock, request: { url: "https://api.stripe.com/v1/charges", method: "GET" } }))).rejects.toMatchObject({ status: 502 });
  });
});
