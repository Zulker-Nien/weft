// app/api/a/[id]/secret/route.ts: a viewer's own secret value, GET (is set?) + PUT (set) + DELETE (clear).
// All three share the same gate / viewer / rate-limit checks through loadRequest + runSecretOp.
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
} = vi.hoisted(() => ({
  appShareAccess: vi.fn(),
  serviceClient: vi.fn(),
  webUser: vi.fn(),
  fetchLimitVerdict: vi.fn(),
  insertFetchLog: vi.fn(),
  isConfigured: vi.fn(),
  createAppSecretStore: vi.fn(),
}));

vi.mock("@/lib/app-share-access", () => ({ appShareAccess }));
vi.mock("@/lib/web-session", () => ({ serviceClient, webUser }));
vi.mock("@/lib/app-fetch-limit", () => ({ fetchLimitVerdict, insertFetchLog, clientIpFromHeaders: (h: Headers) => h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "" }));
vi.mock("@/lib/app-secrets", () => ({ isConfigured }));
vi.mock("@/lib/app-secret-store", () => ({ createAppSecretStore }));

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
  manifest: { secrets: { OPENAI_KEY: { from: "viewer", hosts: ["api.openai.com"], paths: ["/v1/chat"] }, STRIPE_KEY: { from: "author", hosts: ["api.stripe.com"] } } },
};

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
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
  createAppSecretStore.mockReturnValue({
    hasValue: vi.fn().mockResolvedValue(true),
    setValue: vi.fn().mockResolvedValue(undefined),
    removeValue: vi.fn().mockResolvedValue(undefined),
  });
});

afterEach(() => {
  delete process.env.WEFT_MINIAPP_KEY;
});

describe("GET /api/a/[id]/secret", () => {
  it("returns 400 when the name isn't valid", async () => {
    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/a/s1/secret?name=bad"), ctx("s1"));
    expect(res.status).toBe(400);
  });

  it("returns 400 when the name isn't a viewer-provided secret", async () => {
    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/a/s1/secret?name=STRIPE_KEY"), ctx("s1"));
    expect(res.status).toBe(400);
  });

  it("returns 404 when the share is missing", async () => {
    const { GET } = await import("./route");
    appShareAccess.mockResolvedValue({ kind: "missing" });
    const res = await GET(new Request("http://localhost/api/a/s1/secret?name=OPENAI_KEY"), ctx("s1"));
    expect(res.status).toBe(404);
  });

  it("returns 403 when the gate is denied", async () => {
    const { GET } = await import("./route");
    appShareAccess.mockResolvedValue({ kind: "denied" });
    const res = await GET(new Request("http://localhost/api/a/s1/secret?name=OPENAI_KEY"), ctx("s1"));
    expect(res.status).toBe(403);
  });

  it("returns 503 when the service client is missing", async () => {
    const { GET } = await import("./route");
    serviceClient.mockReturnValue(null);
    const res = await GET(new Request("http://localhost/api/a/s1/secret?name=OPENAI_KEY"), ctx("s1"));
    expect(res.status).toBe(503);
  });

  it("returns 401 when the visitor is anonymous", async () => {
    const { GET } = await import("./route");
    webUser.mockResolvedValue(null);
    const res = await GET(new Request("http://localhost/api/a/s1/secret?name=OPENAI_KEY"), ctx("s1"));
    expect(res.status).toBe(401);
    // The 401 must fire before any secret-store call: an anonymous visitor never reaches
    // cloud_app_secrets, on any share mode including public.
    expect(createAppSecretStore).not.toHaveBeenCalled();
  });

  it("returns 429 when the rate limit refuses", async () => {
    const { GET } = await import("./route");
    fetchLimitVerdict.mockResolvedValue({ ok: false, bucket: { kind: "viewer", key: "user-1", count: 60 }, retryAfter: 60 });
    const res = await GET(new Request("http://localhost/api/a/s1/secret?name=OPENAI_KEY"), ctx("s1"));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(insertFetchLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ method: "SECRET", status: 429 }));
  });

  it("returns 503 when WEFT_MINIAPP_KEY is missing", async () => {
    const { GET } = await import("./route");
    isConfigured.mockReturnValue(false);
    const res = await GET(new Request("http://localhost/api/a/s1/secret?name=OPENAI_KEY"), ctx("s1"));
    expect(res.status).toBe(503);
  });

  it("returns { set: true } when the viewer has a value", async () => {
    const { GET } = await import("./route");
    createAppSecretStore.mockReturnValue({ hasValue: vi.fn().mockResolvedValue(true) });
    const res = await GET(new Request("http://localhost/api/a/s1/secret?name=OPENAI_KEY"), ctx("s1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ set: true });
    expect(insertFetchLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ method: "SECRET", path: "/OPENAI_KEY", status: 200 }));
  });

  it("returns { set: false } when the viewer doesn't", async () => {
    const { GET } = await import("./route");
    createAppSecretStore.mockReturnValue({ hasValue: vi.fn().mockResolvedValue(false) });
    const res = await GET(new Request("http://localhost/api/a/s1/secret?name=OPENAI_KEY"), ctx("s1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ set: false });
  });
});

describe("PUT /api/a/[id]/secret", () => {
  function put(body: unknown, headers: Record<string, string> = {}): Request {
    const text = JSON.stringify(body);
    return new Request("http://localhost/api/a/s1/secret", {
      method: "PUT",
      headers: { "content-type": "application/json", "content-length": String(text.length), ...headers },
      body: text,
    });
  }

  it("rejects a non-JSON body with 400", async () => {
    const { PUT } = await import("./route");
    const req = new Request("http://localhost/api/a/s1/secret", { method: "PUT", headers: { "content-type": "application/json" }, body: "not-json" });
    const res = await PUT(req, ctx("s1"));
    expect(res.status).toBe(400);
  });

  it("rejects a body over 4 KB with 413", async () => {
    const { PUT } = await import("./route");
    const big = "x".repeat(4_100);
    const res = await PUT(put({ name: "OPENAI_KEY", value: big }), ctx("s1"));
    expect(res.status).toBe(413);
  });

  it("rejects a missing value with 400", async () => {
    const { PUT } = await import("./route");
    const res = await PUT(put({ name: "OPENAI_KEY" }), ctx("s1"));
    expect(res.status).toBe(400);
  });

  it("returns 401 when the visitor is anonymous", async () => {
    const { PUT } = await import("./route");
    webUser.mockResolvedValue(null);
    const res = await PUT(put({ name: "OPENAI_KEY", value: "sk-x" }), ctx("s1"));
    expect(res.status).toBe(401);
    expect(createAppSecretStore).not.toHaveBeenCalled();
  });

  it("writes the value through the store and returns { set: true }", async () => {
    const { PUT } = await import("./route");
    const setValue = vi.fn().mockResolvedValue(undefined);
    createAppSecretStore.mockReturnValue({ setValue });
    const res = await PUT(put({ name: "OPENAI_KEY", value: "sk-openai-x" }), ctx("s1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ set: true });
    expect(setValue).toHaveBeenCalledWith("s1", "OPENAI_KEY", "user-1", "sk-openai-x");
    expect(insertFetchLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ method: "SECRET", status: 200 }));
  });
});

describe("DELETE /api/a/[id]/secret", () => {
  it("returns 400 when the name isn't valid", async () => {
    const { DELETE } = await import("./route");
    const res = await DELETE(new Request("http://localhost/api/a/s1/secret?name=bad"), ctx("s1"));
    expect(res.status).toBe(400);
  });

  it("returns 400 when the name is an author secret, not a viewer secret", async () => {
    const { DELETE } = await import("./route");
    const res = await DELETE(new Request("http://localhost/api/a/s1/secret?name=STRIPE_KEY"), ctx("s1"));
    expect(res.status).toBe(400);
  });

  it("clears the value through the store and returns { set: false }", async () => {
    const { DELETE } = await import("./route");
    const removeValue = vi.fn().mockResolvedValue(undefined);
    createAppSecretStore.mockReturnValue({ removeValue });
    const res = await DELETE(new Request("http://localhost/api/a/s1/secret?name=OPENAI_KEY"), ctx("s1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ set: false });
    expect(removeValue).toHaveBeenCalledWith("s1", "OPENAI_KEY", "user-1");
    expect(insertFetchLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ method: "SECRET", path: "/OPENAI_KEY", status: 200 }));
  });
});