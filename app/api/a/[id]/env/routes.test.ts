// app/api/a/[id]/env/route.ts: returns the values the manifest declared as `public`. The test mocks the gate
// and the secret store so the route never touches Supabase.
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

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

function share(manifest: unknown = {}) {
  return {
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
    manifest,
  };
}

function get(): Request {
  return new Request("http://localhost/api/a/s1/env", { method: "GET" });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.WEFT_MINIAPP_KEY = "MDEyMzQ1Njc4OTAxMjM0NTY3ODk5OTg3NjU0MzIxMTExMTE=";
  appShareAccess.mockResolvedValue({ kind: "ok", share: share({ public: ["STRIPE_KEY"] }) });
  serviceClient.mockReturnValue({ from: () => ({}) });
  webUser.mockResolvedValue({ id: "user-1", email: null, name: null, avatar: null });
  fetchLimitVerdict.mockResolvedValue({ ok: true, retryAfter: 0 });
  insertFetchLog.mockResolvedValue(undefined);
  isConfigured.mockReturnValue(true);
  createAppSecretStore.mockReturnValue({ getValues: vi.fn().mockResolvedValue({ STRIPE_KEY: "sk_live_x" }) });
});

afterEach(() => {
  delete process.env.WEFT_MINIAPP_KEY;
});

describe("GET /api/a/[id]/env", () => {
  it("returns 404 when the share is missing", async () => {
    const { GET } = await import("./route");
    appShareAccess.mockResolvedValue({ kind: "missing" });
    const res = await GET(get(), ctx("s1"));
    expect(res.status).toBe(404);
  });

  it("returns 403 when the gate is denied", async () => {
    const { GET } = await import("./route");
    appShareAccess.mockResolvedValue({ kind: "denied" });
    const res = await GET(get(), ctx("s1"));
    expect(res.status).toBe(403);
  });

  it("returns 503 when the service client is missing", async () => {
    const { GET } = await import("./route");
    serviceClient.mockReturnValue(null);
    const res = await GET(get(), ctx("s1"));
    expect(res.status).toBe(503);
  });

  it("returns an empty map when manifest.public is undefined (no rate limit or log row)", async () => {
    const { GET } = await import("./route");
    appShareAccess.mockResolvedValue({ kind: "ok", share: share({}) });
    const res = await GET(get(), ctx("s1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ values: {} });
    expect(fetchLimitVerdict).not.toHaveBeenCalled();
    expect(insertFetchLog).not.toHaveBeenCalled();
  });

  it("returns an empty map when manifest.public is empty", async () => {
    const { GET } = await import("./route");
    appShareAccess.mockResolvedValue({ kind: "ok", share: share({ public: [] }) });
    const res = await GET(get(), ctx("s1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ values: {} });
    expect(fetchLimitVerdict).not.toHaveBeenCalled();
  });

  it("returns 429 with Retry-After when the rate limit refuses", async () => {
    const { GET } = await import("./route");
    fetchLimitVerdict.mockResolvedValue({ ok: false, bucket: { kind: "viewer", key: "user-1", count: 60 }, retryAfter: 60 });
    const res = await GET(get(), ctx("s1"));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(insertFetchLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ method: "ENV", status: 429 }));
  });

  it("returns 503 when WEFT_MINIAPP_KEY is missing", async () => {
    const { GET } = await import("./route");
    isConfigured.mockReturnValue(false);
    const res = await GET(get(), ctx("s1"));
    expect(res.status).toBe(503);
  });

  it("returns the values for the manifest's public names and logs the call", async () => {
    const { GET } = await import("./route");
    createAppSecretStore.mockReturnValue({ getValues: vi.fn().mockResolvedValue({ STRIPE_KEY: "sk_live_x", OPENAI_KEY: "sk-openai-x" }) });
    appShareAccess.mockResolvedValue({ kind: "ok", share: share({ public: ["STRIPE_KEY", "OPENAI_KEY"] }) });
    const res = await GET(get(), ctx("s1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ values: { STRIPE_KEY: "sk_live_x", OPENAI_KEY: "sk-openai-x" } });
    // Author names, viewer empty — same shape the store expects.
    const getValues = (createAppSecretStore.mock.results[0] as { value: { getValues: ReturnType<typeof vi.fn> } }).value.getValues;
    expect(getValues).toHaveBeenCalledWith("s1", { author: ["STRIPE_KEY", "OPENAI_KEY"], viewer: [] }, null);
    expect(insertFetchLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ method: "ENV", path: "/env", status: 200 }));
  });

  it("drops names that aren't valid identifiers from manifest.public", async () => {
    const { GET } = await import("./route");
    appShareAccess.mockResolvedValue({ kind: "ok", share: share({ public: ["STRIPE_KEY", "lower_case", "1NUM", ""] }) });
    const res = await GET(get(), ctx("s1"));
    expect(res.status).toBe(200);
    const getValues = (createAppSecretStore.mock.results[0] as { value: { getValues: ReturnType<typeof vi.fn> } }).value.getValues;
    expect(getValues).toHaveBeenCalledWith("s1", { author: ["STRIPE_KEY"], viewer: [] }, null);
  });
});