import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// /api/email/webhook is Resend's email.received delivery on the deployed Weft; lib/email-forward is mocked, the env check is real.

vi.mock("@/lib/email-forward", () => ({
  handle: vi.fn(() => Promise.resolve(new Response("Forwarded as x", { status: 200 }))),
  restMailer: vi.fn(() => ({ mailer: true })),
}));

const lib = await import("@/lib/email-forward");
const route = await import("./email/webhook/route");

const ENV: Record<string, string> = { RESEND_API_KEY: "re_x", RESEND_WEBHOOK_SECRET: "whsec_x", EMAIL_FORWARD_TO: "me@gmail.test" };
const delivery = () => new Request("https://weft.example/api/email/webhook", { method: "POST", headers: { host: "weft.example" }, body: "{}" });

beforeEach(() => {
  vi.clearAllMocks();
  for (const [name, value] of Object.entries(ENV)) vi.stubEnv(name, value);
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/email/webhook", () => {
  it("says when forwarding isn't set up, with no localhost guard in the way", async () => {
    for (const name of Object.keys(ENV)) {
      vi.stubEnv(name, "");
      expect((await route.POST(delivery())).status).toBe(503);
      vi.stubEnv(name, ENV[name] ?? "");
    }
    expect(lib.handle).not.toHaveBeenCalled();
  });

  it("hands the delivery to the forwarder with a mailer on Resend", async () => {
    expect((await route.POST(delivery())).status).toBe(200);
    expect(lib.restMailer).toHaveBeenCalledWith("re_x");
    expect(lib.handle).toHaveBeenCalledWith(expect.any(Request), { secret: "whsec_x", to: "me@gmail.test", from: "forward@weft.zip", mailer: { mailer: true } });
  });

  it("sends from EMAIL_FORWARD_FROM when it's set", async () => {
    vi.stubEnv("EMAIL_FORWARD_FROM", "mail@weft.zip");
    await route.POST(delivery());
    expect(lib.handle).toHaveBeenCalledWith(expect.any(Request), expect.objectContaining({ from: "mail@weft.zip" }));
  });

  it("answers 502 when Resend fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(lib.handle).mockRejectedValueOnce(new Error("Resend 500 on /emails: down"));
    expect((await route.POST(delivery())).status).toBe(502);
    expect(error).toHaveBeenCalledWith("Email webhook: Resend 500 on /emails: down");
    error.mockRestore();
  });
});
