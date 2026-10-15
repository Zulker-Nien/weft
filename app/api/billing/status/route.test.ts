import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The deployed Weft's /api/billing/status route: bearer auth, the service client, and the assembled JSON. The
// Puku trial route's tests (app/api/puku-routes.test.ts) are the closest sibling in style.

const { accountUserId, billingService, billingStatus } = vi.hoisted(() => ({
  accountUserId: vi.fn(),
  billingService: vi.fn(),
  billingStatus: vi.fn(),
}));
vi.mock("@/lib/account", () => ({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_KEY: "anon" }));
vi.mock("@/lib/puku-trial-token", () => ({ accountUserId }));
vi.mock("@/lib/billing/billing", () => ({ billingService }));
vi.mock("@/lib/billing/status", () => ({ billingStatus }));

const route = await import("./route");

function get(headers: Record<string, string> = {}) {
  return route.GET(new Request("https://weft.example/api/billing/status", { method: "GET", headers }));
}

const STATUS = {
  org: { slug: "ada", name: "Ada" },
  plan: { id: "pro", name: "Pro" },
  status: "active",
  interval: "monthly",
  periodEnd: "2026-11-13T00:00:00.000Z",
  cancelAtPeriodEnd: false,
  puku: null,
  manageUrl: "https://weft.zip/ada/billing",
};

beforeEach(() => {
  vi.clearAllMocks();
  billingService.mockReturnValue({});
  vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("GET /api/billing/status", () => {
  it("is 401 without a bearer token", async () => {
    const res = await get();
    expect(res.status).toBe(401);
    expect(accountUserId).not.toHaveBeenCalled();
  });

  it("is 401 when the access token doesn't resolve to a Weft user", async () => {
    accountUserId.mockResolvedValueOnce(null);
    const res = await get({ authorization: "Bearer bad" });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Your Weft sign-in has expired. Sign in again." });
  });

  it("is 503 when billingService is null (no SUPABASE_SECRET_KEY)", async () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    billingService.mockReturnValueOnce(null);
    const res = await get({ authorization: "Bearer acc" });
    expect(res.status).toBe(503);
    expect(billingStatus).not.toHaveBeenCalled();
  });

  it("is 404 when the user has no workspace", async () => {
    billingService.mockReturnValueOnce({});
    accountUserId.mockResolvedValueOnce("u1");
    billingStatus.mockResolvedValueOnce(null);
    const res = await get({ authorization: "Bearer acc" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "No workspace for this account." });
  });

  it("returns the status JSON on the happy path", async () => {
    billingService.mockReturnValueOnce({ svc: true });
    accountUserId.mockResolvedValueOnce("u1");
    billingStatus.mockResolvedValueOnce(STATUS);
    const res = await get({ authorization: "Bearer acc" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(STATUS);
    expect(accountUserId).toHaveBeenCalledWith("acc", "https://x.supabase.co", "anon");
    expect(billingStatus).toHaveBeenCalledWith({ svc: true }, "u1");
  });

  it("is 502 when checking the sign-in throws", async () => {
    billingService.mockReturnValueOnce({});
    accountUserId.mockRejectedValueOnce(new Error("supabase down"));
    const res = await get({ authorization: "Bearer acc" });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Couldn't check your Weft sign-in." });
  });

  it("is 502 when assembling the status throws", async () => {
    billingService.mockReturnValueOnce({});
    accountUserId.mockResolvedValueOnce("u1");
    billingStatus.mockRejectedValueOnce(new Error("ledger down"));
    const res = await get({ authorization: "Bearer acc" });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Couldn't load billing status." });
  });
});
