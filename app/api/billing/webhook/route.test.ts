import { beforeEach, describe, expect, it, vi } from "vitest";

// The Stripe webhook route is a one-liner that hands the request to billing.handleStripeWebhook; the
// package owns signature verification, the `metadata.app` drop, and the Supabase mirror. This test
// pins the wiring (the right handler is called with the right request and the service getter).

const { handleStripeWebhook, billingService } = vi.hoisted(() => ({
  handleStripeWebhook: vi.fn<(req: Request, getService: () => unknown) => Promise<Response>>(() => Promise.resolve(new Response("ok", { status: 200 }))),
  billingService: vi.fn(() => ({ svc: true })),
}));

const billingMock = { handleStripeWebhook };

vi.mock("@/lib/billing/billing", () => ({ billing: billingMock, billingService }));

const route = await import("./route");

const delivery = () =>
  new Request("https://weft.example/api/billing/webhook", { method: "POST", headers: { "stripe-signature": "t=1,v1=x" }, body: "{}" });

beforeEach(() => {
  vi.clearAllMocks();
  handleStripeWebhook.mockImplementation(() => Promise.resolve(new Response("ok", { status: 200 })));
  billingService.mockReturnValue({ svc: true });
});

describe("POST /api/billing/webhook", () => {
  it("hands the request to billing.handleStripeWebhook with billingService", async () => {
    const req = delivery();
    const res = await route.POST(req);
    expect(res.status).toBe(200);
    expect(handleStripeWebhook).toHaveBeenCalledTimes(1);
    const [passedReq, passedGetService] = handleStripeWebhook.mock.calls[0]!;
    expect(passedReq).toBe(req);
    // Pass the getter itself (not a value) so the handler can ask for the client lazily; null on
    // an unconfigured Weft would have the package return 500 for Stripe to retry.
    expect(typeof passedGetService).toBe("function");
    expect(passedGetService()).toEqual({ svc: true });
  });

  it("lets the package's response bubble out (signature failures stay 4xx, not 500s)", async () => {
    handleStripeWebhook.mockResolvedValueOnce(new Response("bad sig", { status: 400 }));
    const res = await route.POST(delivery());
    expect(res.status).toBe(400);
  });
});
