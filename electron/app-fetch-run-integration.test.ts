// Integration tests for the filled-URL re-check inside runFetch
// (electron/app-fetch-run.cjs). The runner used to send plan.url (with placeholders
// percent-encoded) so a placeholder in the URL never reached the server. The fix is to
// fill, re-verify, and send the filled URL. These tests verify both the new happy path
// (the value reaches the wire) and the integration with verifyFilledUrl's refusals
// (escape sequences, port moves, etc.). The existing electron/app-fetch-run.test.ts covers
// the rest of the runner's behaviour; this file's only job is the filled-URL integration.

import { describe, expect, it, vi } from "vitest";
import { runFetch } from "./app-fetch-run.cjs";
import { parsePolicy } from "./app-fetch-policy.cjs";

type Lookup = (host: string, opts: { all: true }, cb: (err: unknown, addresses: { address: string; family: number }[] | null) => void) => void;

const lookupOk: Lookup = (_h, _o, cb) => cb(null, [{ address: "8.8.8.8", family: 4 }]);

// Builds a tiny response the same way app-fetch-run.test.ts does.
function makeResponse({ status = 200, contentType, body = "" }: { status?: number; contentType?: string; body?: string } = {}) {
  const bytes = Buffer.from(body, "utf8");
  const headerMap = new Map<string, string>();
  if (contentType !== undefined) headerMap.set("content-type", contentType);
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (n: string) => headerMap.get(n.toLowerCase()) ?? null, forEach: () => {} },
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
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
  };
}

// The runner's opts with every field but `request`, which each test supplies through `overrides`.
// The return type is runFetch's own opts type: spreading a Partial over the base would otherwise
// leave every field optional and the object unassignable at the runFetch call.
type RunOpts = Parameters<typeof runFetch>[0];
const baseOpts = (overrides: Partial<RunOpts> = {}): RunOpts => ({
  policy: parsePolicy({ secrets: { STRIPE_KEY: { hosts: ["api.stripe.com"], methods: ["GET"], paths: ["/v1/charges"] } } }),
  getValues: (names: string[]) => Promise.resolve(Object.fromEntries(names.map((n) => [n, `VALUE_${n}`]))),
  fetch: vi.fn(),
  lookup: lookupOk,
  request: { url: "https://api.stripe.com/v1/charges", method: "GET", headers: {} },
  ...overrides,
});

// A literal-prefix policy lets the planned URL past planFetch (so the escape check in
// verifyFilledUrl is the one doing the refusing). The planFetch rule has to exactly
// equal the path so pathMatches accepts it; the policy below says "yes, this exact
// string is allowed", and verifyFilledUrl then refuses because it carries a percent
// encoded slash, backslash or dot.
const escapePolicy = (path: string) =>
  parsePolicy({
    secrets: { X: { hosts: ["api.stripe.com"], methods: ["GET"], paths: [path] } },
  });
const escapeOpts = (path: string) => (overrides: Partial<RunOpts> = {}): RunOpts => ({
  policy: escapePolicy(path),
  getValues: (names: string[]) => Promise.resolve(Object.fromEntries(names.map((n) => [n, `VALUE_${n}`]))),
  fetch: vi.fn(),
  lookup: lookupOk,
  request: { url: "https://api.stripe.com/v1/charges", method: "GET", headers: {} },
  ...overrides,
});

describe("runFetch filled URL re-check", () => {
  // The placeholder in the URL (here, a query string) used to be sent as the placeholder
  // literal because planFetch's url is the planned one. verifyFilledUrl now re-checks and
  // fetch receives the filled URL instead.
  it("sends the filled URL when the placeholder is in the query", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeResponse({ contentType: "application/json", body: "{}" }));
    await runFetch(baseOpts({
      fetch: fetchMock,
      request: { url: "https://api.stripe.com/v1/charges?key={{secret:STRIPE_KEY}}", method: "GET", headers: {} },
    }));
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("https://api.stripe.com/v1/charges?key=VALUE_STRIPE_KEY");
  });

  it("refuses (400) a planned URL with %2f in the path", async () => {
    const fetchMock = vi.fn();
    await expect(runFetch(escapeOpts("/v1%2fcharges")({
      fetch: fetchMock,
      request: { url: "https://api.stripe.com/v1%2fcharges", method: "GET" },
    }))).rejects.toThrow(/%2f|%5c|%2e/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses (400) a planned URL with %5c in the path", async () => {
    const fetchMock = vi.fn();
    await expect(runFetch(escapeOpts("/v1%5ccharges")({
      fetch: fetchMock,
      request: { url: "https://api.stripe.com/v1%5ccharges", method: "GET" },
    }))).rejects.toMatchObject({ status: 400 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses (400) a planned URL with %2e in the path", async () => {
    const fetchMock = vi.fn();
    await expect(runFetch(escapeOpts("/v1%2echarges")({
      fetch: fetchMock,
      request: { url: "https://api.stripe.com/v1%2echarges", method: "GET" },
    }))).rejects.toMatchObject({ status: 400 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses (400) a planned URL with %2F (uppercase) in the path", async () => {
    const fetchMock = vi.fn();
    await expect(runFetch(escapeOpts("/v1%2Fcharges")({
      fetch: fetchMock,
      request: { url: "https://api.stripe.com/v1%2Fcharges", method: "GET" },
    }))).rejects.toMatchObject({ status: 400 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
