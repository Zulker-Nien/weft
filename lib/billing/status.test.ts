import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// lib/billing/status.ts: joins the user's workspace, its subscription and the Puku balance into the desktop's
// view. billing / org / plans come from the sibling files another thread is also editing; they're mocked here so
// the test can pin the exact status / balance shape the route returns.

const { orgForUser, subscription, balance } = vi.hoisted(() => ({
  orgForUser: vi.fn(),
  subscription: vi.fn(),
  balance: vi.fn(),
}));
vi.mock("./billing", () => ({ billing: { subscription, balance } }));
vi.mock("./org", () => ({ orgForUser }));
vi.mock("./plans", () => ({
  catalog: {
    get: (id: string) => ({ id, name: id === "pro" ? "Pro" : "Free" }),
    allowance: (id: string, meter: string) => (id === "pro" && meter === "puku_tokens" ? { amount: 300_000_000 } : null),
  },
  PUKU_METER: "puku_tokens",
}));

async function load() {
  vi.resetModules();
  return import("./status");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const ORG = { id: "org1", slug: "ada", name: "Ada" };
const SUB = {
  orgId: "org1",
  plan: "pro",
  status: "active",
  interval: "monthly",
  currentPeriodEnd: "2026-11-13T00:00:00.000Z",
  cancelAtPeriodEnd: false,
  trialEnd: null,
  seats: 1,
  unitAmountCents: 2000,
  currency: "usd",
  canceledAt: null,
  provider: "stripe",
  providerCustomerId: "cus_1",
  providerSubscriptionId: "sub_1",
  currentPeriodStart: "2026-10-13T00:00:00.000Z",
};
const PUKU = {
  meter: "puku_tokens",
  allowance: 300_000_000,
  granted: 0,
  spent: 12_345_678,
  remaining: 287_654_322,
  window: { start: "2026-10-13T00:00:00.000Z", end: "2026-11-13T00:00:00.000Z" },
  resets: true,
};

describe("billingStatus", () => {
  it("returns null when the user has no workspace", async () => {
    orgForUser.mockResolvedValueOnce(null);
    const { billingStatus } = await load();
    expect(await billingStatus({} as never, "u1")).toBeNull();
    expect(subscription).not.toHaveBeenCalled();
    expect(balance).not.toHaveBeenCalled();
  });

  it("joins the workspace, its Pro subscription and the Puku balance into a status JSON", async () => {
    orgForUser.mockResolvedValueOnce(ORG);
    subscription.mockResolvedValueOnce(SUB);
    balance.mockResolvedValueOnce(PUKU);
    const { billingStatus } = await load();
    const status = await billingStatus({} as never, "u1");
    expect(status).toEqual({
      org: { slug: "ada", name: "Ada" },
      plan: { id: "pro", name: "Pro" },
      status: "active",
      interval: "monthly",
      periodEnd: "2026-11-13T00:00:00.000Z",
      cancelAtPeriodEnd: false,
      puku: PUKU,
      manageUrl: "https://weft.zip/ada/billing",
    });
    expect(subscription).toHaveBeenCalledWith({}, "org1");
    expect(balance).toHaveBeenCalledWith({}, "org1", "puku_tokens");
  });

  it("uses NEXT_PUBLIC_SITE_URL for the manage page when set", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://staging.example/");
    orgForUser.mockResolvedValueOnce(ORG);
    subscription.mockResolvedValueOnce(SUB);
    balance.mockResolvedValueOnce(PUKU);
    const { billingStatus } = await load();
    const status = await billingStatus({} as never, "u1");
    expect(status?.manageUrl).toBe("https://staging.example/ada/billing");
  });

  it("skips the balance call and sets puku to null when the plan has no Puku allowance (Free)", async () => {
    orgForUser.mockResolvedValueOnce(ORG);
    subscription.mockResolvedValueOnce({ ...SUB, plan: "free", status: "active" });
    const { billingStatus } = await load();
    const status = await billingStatus({} as never, "u1");
    expect(status?.plan).toEqual({ id: "free", name: "Free" });
    expect(status?.puku).toBeNull();
    expect(balance).not.toHaveBeenCalled();
  });

  it("passes through the subscription's interval, period end and cancel flag", async () => {
    orgForUser.mockResolvedValueOnce(ORG);
    subscription.mockResolvedValueOnce({ ...SUB, interval: "yearly", currentPeriodEnd: "2027-10-13T00:00:00.000Z", cancelAtPeriodEnd: true });
    const { billingStatus } = await load();
    const status = await billingStatus({} as never, "u1");
    expect(status?.interval).toBe("yearly");
    expect(status?.periodEnd).toBe("2027-10-13T00:00:00.000Z");
    expect(status?.cancelAtPeriodEnd).toBe(true);
  });
});
