// app/api/a/[id]/fetch/route.ts: gates the runFetch layer, splits secrets by `from`, rate-limits, and
// logs every attempt. The cjs runFetch is loaded through a dynamic import; the test mocks that import so
// the route's behaviour is testable without hitting the network or DNS. parseAppFetchRequest and the
// AppFetchResult shape are tested in lib/app-bridge.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ connection: async () => {} }));

const {
  appShareAccess,
  serviceClient,
  webUser,
  fetchLimitVerdict,
  insertFetchLog,
  isConfigured,
  createAppSecretStore,
  splitByManifest,
  runFetch,
} = vi.hoisted(() => ({
  appShareAccess: vi.fn(),
  serviceClient: vi.fn(),
  webUser: vi.fn(),
  fetchLimitVerdict: vi.fn(),
  insertFetchLog: vi.fn(),
  isConfigured: vi.fn(),
  createAppSecretStore: vi.fn(),
  splitByManifest: vi.fn(),
  runFetch: vi.fn(),
}));

vi.mock("@/lib/app-share-access", () => ({ appShareAccess }));
vi.mock("@/lib/web-session", () => ({ serviceClient, webUser }));
vi.mock("@/lib/app-fetch-limit", () => ({ fetchLimitVerdict, insertFetchLog, clientIpFromHeaders: (h: Headers) => h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "" }));
vi.mock("@/lib/app-secrets", () => ({ isConfigured }));
vi.mock("@/lib/app-secret-store", () => ({ createAppSecretStore, splitByManifest }));
// Stub the cjs dynamic imports so the test never loads the real runFetch/secretNames. Path is from this
// test file: 4 `..` lands at the repo root.
vi.mock("../../../../../electron/app-fetch-run.cjs", () => ({ runFetch }));
vi.mock("../../../../../electron/app-fetch-policy.cjs", () => ({ secretNames: vi.fn((req: { url: string; headers: Record<string, string>; body?: string }) => {
  const names = new Set<string>();
  const re = /\{\{secret:([A-Za-z_][A-Za-z0-9_]{0,63})\}\}/g;
  const collect = (s: unknown) => { if (typeof s === "string") { let m: RegExpExecArray | null; while ((m = re.exec(s)) !== null) names.add(m[1]!); } };
  collect(req.url);
  for (const v of Object.values(req.headers)) collect(v);
  collect(req.body);
  return [...names];
}) }));

async function load() {
  vi.resetModules();
  return import("./route");
}

const SHARE = {
  id: "s1",
  org_id: "org-1",
  app_id: "app-1",
  name: "Growth",
  kind: "folder",
  page: "index.html",
  mode: "public",
  password_hash: null,
  has_password: false,
  created_by: "u1",
  created_at: "2026-10-18T00:00:00.000Z",
  updated_at: "2026-10-18T00:00:00.000Z",
  owner: "user",
  slug: "growth",
  files: null,
  manifest: { secrets: { STRIPE_KEY: { hosts: ["api.stripe.com"], paths: ["/v1/charges"] } } },
};

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost/api/a/s1/fetch`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function okFetchResult() {
  return { status: 200, ok: true, headers: { "content-type": "application/json" }, body: "{\"ok\":true}", bodyEncoding: "utf8" };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.WEFT_MINIAPP_KEY = "MDEyMzQ1Njc4OTAxMjM0NTY3ODk5OTg3NjU0MzIxMTExMTE=";
  appShareAccess.mockResolvedValue({ kind: "ok", share: { ...SHARE } });
  serviceClient.mockReturnValue({ from: () => ({}) });
  webUser.mockResolvedValue({ id: "user-1", email: null, name: null, avatar: null });
  fetchLimitVerdict.mockResolvedValue({ ok: true, retryAfter: 0 });
  insertFetchLog.mockResolvedValue(undefined);
  isConfigured.mockReturnValue(true);
  createAppSecretStore.mockReturnValue({ getValues: vi.fn().mockResolvedValue({}) });
  splitByManifest.mockReturnValue({ author: [], viewer: [] });
  runFetch.mockResolvedValue(okFetchResult());
});

afterEach(() => {
  delete process.env.WEFT_MINIAPP_KEY;
});

describe("POST /api/a/[id]/fetch", () => {
  it("rejects a non-JSON body with 400", async () => {
    const { POST } = await load();
    const req = new Request("http://localhost/api/a/s1/fetch", { method: "POST", headers: { "content-type": "application/json" }, body: "not-json" });
    const res = await POST(req, ctx("s1"));
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error?: string };
    expect(json.error).toEqual(expect.any(String));
  });

  it("rejects a body that doesn't have the AppFetchRequest shape", async () => {
    const { POST } = await load();
    const res = await POST(post({ url: 123, method: "GET", headers: {} }), ctx("s1"));
    expect(res.status).toBe(400);
  });

  it("rejects a body over 1 MB with 413", async () => {
    const { POST } = await load();
    // JSON envelope + a 1 MB body string pushes the wire size past 1 MB.
    const big = "x".repeat(1_100_000);
    const body = JSON.stringify({ url: "https://api.stripe.com/v1/charges", method: "GET", headers: {}, body: big });
    const req = new Request("http://localhost/api/a/s1/fetch", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": String(body.length) },
      body,
    });
    const res = await POST(req, ctx("s1"));
    expect(res.status).toBe(413);
  });

  it("returns 404 when the share row is missing", async () => {
    const { POST } = await load();
    appShareAccess.mockResolvedValue({ kind: "missing" });
    const res = await POST(post({ url: "https://api.stripe.com/v1/charges", method: "GET", headers: {} }), ctx("s1"));
    expect(res.status).toBe(404);
  });

  it("returns 403 when the gate is not ok", async () => {
    const { POST } = await load();
    appShareAccess.mockResolvedValue({ kind: "denied" });
    const res = await POST(post({ url: "https://api.stripe.com/v1/charges", method: "GET", headers: {} }), ctx("s1"));
    expect(res.status).toBe(403);
  });

  it("returns 503 when the service client is missing", async () => {
    const { POST } = await load();
    serviceClient.mockReturnValue(null);
    const res = await POST(post({ url: "https://api.stripe.com/v1/charges", method: "GET", headers: {} }), ctx("s1"));
    expect(res.status).toBe(503);
  });

  it("returns 429 with Retry-After when the rate limit verdict is not ok", async () => {
    const { POST } = await load();
    fetchLimitVerdict.mockResolvedValue({ ok: false, bucket: { kind: "viewer", key: "user-1", count: 60 }, retryAfter: 60 });
    const res = await POST(post({ url: "https://api.stripe.com/v1/charges", method: "GET", headers: {} }), ctx("s1"));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(insertFetchLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: 429 }));
  });

  it("returns 401 when viewer secrets are needed but the visitor is anonymous", async () => {
    const { POST } = await load();
    webUser.mockResolvedValue(null);
    splitByManifest.mockReturnValue({ author: [], viewer: ["OPENAI_KEY"] });
    const res = await POST(post({ url: "https://api.openai.com/v1/chat", method: "POST", headers: {} }), ctx("s1"));
    expect(res.status).toBe(401);
    // The 401 must fire before any secret-store call: an anonymous visitor on a public share never
    // reaches cloud_app_secrets.
    expect(createAppSecretStore).not.toHaveBeenCalled();
  });

  it("returns 503 when WEFT_MINIAPP_KEY is missing and the request needs secrets", async () => {
    const { POST } = await load();
    isConfigured.mockReturnValue(false);
    // The route reads the names from the request — this needs a request with a placeholder.
    const req = post({ url: "https://api.stripe.com/v1/charges", method: "GET", headers: { authorization: "Bearer {{secret:STRIPE_KEY}}" } });
    const res = await POST(req, ctx("s1"));
    expect(res.status).toBe(503);
  });

  it("calls runFetch with the values map and returns AppFetchResult on success", async () => {
    const { POST } = await load();
    createAppSecretStore.mockReturnValue({ getValues: vi.fn().mockResolvedValue({ STRIPE_KEY: "sk_live_x" }) });
    splitByManifest.mockReturnValue({ author: ["STRIPE_KEY"], viewer: [] });
    const res = await POST(post({ url: "https://api.stripe.com/v1/charges", method: "GET", headers: { authorization: "Bearer {{secret:STRIPE_KEY}}" } }), ctx("s1"));
    expect(runFetch).toHaveBeenCalled();
    const call = runFetch.mock.calls[0]![0] as { getValues: () => Promise<Record<string, string>> };
    const values = await call.getValues();
    expect(values).toEqual({ STRIPE_KEY: "sk_live_x" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 200, body: "{\"ok\":true}" });
  });

  it("logs the response status on success", async () => {
    const { POST } = await load();
    await POST(post({ url: "https://api.stripe.com/v1/charges", method: "GET", headers: {} }), ctx("s1"));
    expect(insertFetchLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: 200, method: "GET", host: "api.stripe.com", path: "/v1/charges" }));
  });

  it("translates runFetch errors to { error, status } and logs the status", async () => {
    const { POST } = await load();
    const err = new Error("rate limit") as Error & { status: number };
    err.status = 429;
    runFetch.mockRejectedValueOnce(err);
    const res = await POST(post({ url: "https://api.stripe.com/v1/charges", method: "GET", headers: {} }), ctx("s1"));
    expect(res.status).toBe(429);
    expect(insertFetchLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: 429 }));
  });

  it("strips the query string from the logged path", async () => {
    const { POST } = await load();
    await POST(post({ url: "https://api.stripe.com/v1/charges?secret=leak", method: "GET", headers: {} }), ctx("s1"));
    expect(insertFetchLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ path: "/v1/charges" }));
  });
});
