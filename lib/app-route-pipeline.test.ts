import { beforeEach, describe, expect, it, vi } from "vitest";

const { appShareAccess, serviceClient, fetchLimitVerdict, insertFetchLog, isConfigured, createAppSecretStore } = vi.hoisted(() => ({
  appShareAccess: vi.fn(),
  serviceClient: vi.fn(),
  fetchLimitVerdict: vi.fn(),
  insertFetchLog: vi.fn(),
  isConfigured: vi.fn(),
  createAppSecretStore: vi.fn(),
}));

vi.mock("@/lib/app-share-access", () => ({ appShareAccess }));
vi.mock("@/lib/web-session", () => ({ serviceClient }));
vi.mock("@/lib/app-fetch-limit", () => ({ fetchLimitVerdict, insertFetchLog, clientIpFromHeaders: (h: Headers) => h.get("x-forwarded-for") ?? "" }));
vi.mock("@/lib/app-secrets", () => ({ isConfigured }));
vi.mock("@/lib/app-secret-store", () => ({ createAppSecretStore }));

import { errMessage, errStatus, gateShare, parseBoundedBody, rateLimitGuard, requireService, resolveValues, runLogged } from "./app-route-pipeline";

const service = { tag: "service" } as never;
const attempt = { shareId: "s1", viewerId: "v1", method: "GET", host: "api.example.com", path: "/x" };

function post(body: string, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api", { method: "POST", body, headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  insertFetchLog.mockResolvedValue(undefined);
});

describe("parseBoundedBody", () => {
  it("refuses a declared length over the cap with a 413", async () => {
    const res = await parseBoundedBody(post("{}", { "content-length": "11" }), 10);
    expect((res as Response).status).toBe(413);
    await expect((res as Response).json()).resolves.toEqual({ error: "request body is too large.", status: 413 });
  });

  it("refuses a body that isn't JSON with a 400", async () => {
    const res = await parseBoundedBody(post("nope"), 1024);
    await expect((res as Response).json()).resolves.toEqual({ error: "request body must be JSON.", status: 400 });
  });

  it("wraps the parsed body so null is never mistaken for a refusal", async () => {
    await expect(parseBoundedBody(post("null"), 1024)).resolves.toEqual({ body: null });
    await expect(parseBoundedBody(post('{"a":1}'), 1024)).resolves.toEqual({ body: { a: 1 } });
  });
});

describe("gateShare", () => {
  it("is a 404 for a link that's gone and a 403 for one that isn't yours", async () => {
    appShareAccess.mockResolvedValueOnce({ kind: "missing" });
    expect(((await gateShare("s1")) as Response).status).toBe(404);
    appShareAccess.mockResolvedValueOnce({ kind: "denied" });
    expect(((await gateShare("s1")) as Response).status).toBe(403);
  });

  it("returns the share when the gate lets the viewer in", async () => {
    appShareAccess.mockResolvedValueOnce({ kind: "ok", share: { manifest: { reads: {} } } });
    await expect(gateShare("s1")).resolves.toEqual({ manifest: { reads: {} } });
  });
});

describe("requireService", () => {
  it("is a 503 without the service key, else the client", async () => {
    serviceClient.mockReturnValueOnce(null);
    const res = requireService() as Response;
    await expect(res.json()).resolves.toEqual({ error: "this server isn't configured to run apps.", status: 503 });
    serviceClient.mockReturnValueOnce(service);
    expect(requireService()).toBe(service);
  });
});

describe("rateLimitGuard", () => {
  it("lets an attempt under budget through without a log row", async () => {
    fetchLimitVerdict.mockResolvedValueOnce({ ok: true, retryAfter: 0 });
    await expect(rateLimitGuard(service, post("{}", { "x-forwarded-for": "1.2.3.4" }), attempt)).resolves.toBeNull();
    expect(fetchLimitVerdict).toHaveBeenCalledWith(service, "s1", "v1", "1.2.3.4");
    expect(insertFetchLog).not.toHaveBeenCalled();
  });

  it("logs a 429 and answers with Retry-After when over budget", async () => {
    fetchLimitVerdict.mockResolvedValueOnce({ ok: false, retryAfter: 60 });
    const res = (await rateLimitGuard(service, post("{}"), attempt)) as Response;
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    await expect(res.json()).resolves.toEqual({ error: "rate limit exceeded", status: 429 });
    expect(insertFetchLog).toHaveBeenCalledWith(service, { ...attempt, status: 429 });
  });

  it("takes the route's own budget and message", async () => {
    const limit = vi.fn().mockResolvedValue({ ok: false, retryAfter: 5 });
    const res = (await rateLimitGuard(service, post("{}"), attempt, { limit, message: "slow down" })) as Response;
    expect(fetchLimitVerdict).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toEqual({ error: "slow down", status: 429 });
  });
});

describe("resolveValues", () => {
  const split = { author: ["KEY"], viewer: [] };

  it("never touches the store when the call names no secrets", async () => {
    await expect(resolveValues(service, "s1", [], { author: [], viewer: [] }, null)).resolves.toEqual({});
    expect(isConfigured).not.toHaveBeenCalled();
    expect(createAppSecretStore).not.toHaveBeenCalled();
  });

  it("is a 503 when secrets aren't set up on the server", async () => {
    isConfigured.mockReturnValueOnce(false);
    const res = (await resolveValues(service, "s1", ["KEY"], split, null)) as Response;
    await expect(res.json()).resolves.toEqual({ error: "App secrets aren't set up on this server.", status: 503 });
  });

  it("reads the split from the store as the viewer", async () => {
    isConfigured.mockReturnValueOnce(true);
    const getValues = vi.fn().mockResolvedValue({ KEY: "v" });
    createAppSecretStore.mockReturnValueOnce({ getValues });
    await expect(resolveValues(service, "s1", ["KEY"], split, "v1")).resolves.toEqual({ KEY: "v" });
    expect(getValues).toHaveBeenCalledWith("s1", split, "v1");
  });
});

describe("errStatus / errMessage", () => {
  it("reads a numeric .status, else 500", () => {
    expect(errStatus(Object.assign(new Error("x"), { status: 418 }))).toBe(418);
    expect(errStatus({ status: "418" })).toBe(500);
    expect(errStatus(null)).toBe(500);
    expect(errStatus("boom")).toBe(500);
  });

  it("reads an Error's message, else the thrown value as text", () => {
    expect(errMessage(new Error("bad"))).toBe("bad");
    expect(errMessage(42)).toBe("42");
  });
});

describe("runLogged", () => {
  it("logs the call's status and answers its body, uncacheable", async () => {
    const res = await runLogged(service, attempt, () => Promise.resolve({ status: 201, body: { ok: 1 } }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    await expect(res.json()).resolves.toEqual({ ok: 1 });
    expect(insertFetchLog).toHaveBeenCalledWith(service, { ...attempt, status: 201 });
  });

  it("logs and answers a thrown error's status", async () => {
    const res = await runLogged(service, attempt, () => Promise.reject(Object.assign(new Error("upstream 502"), { status: 502 })));
    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({ error: "upstream 502", status: 502 });
    expect(insertFetchLog).toHaveBeenCalledWith(service, { ...attempt, status: 502 });
  });
});
