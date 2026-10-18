import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The three league routes: emails (cron bearer + run), open (302 to weft://league), unsubscribe
// (GET confirm page, POST optOut). The lib is mocked; the env check is real.

vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/lib/league-mail-send", () => ({
  runLeagueMails: vi.fn(),
  restMailStore: vi.fn(),
  resendSender: vi.fn(),
  verifyUnsubscribe: vi.fn(),
}));

const lib = await import("@/lib/league-mail-send");
const emailsRoute = await import("./league/emails/route");
const openRoute = await import("./league/open/route");
const unsubRoute = await import("./league/unsubscribe/route");

const FULL_ENV: Record<string, string> = {
  CRON_SECRET: "cron",
  SUPABASE_SECRET_KEY: "sb_x",
  RESEND_API_KEY: "re_x",
  LEAGUE_EMAIL_SECRET: "le_x",
  NEXT_PUBLIC_SITE_URL: "https://dev.weft",
};

beforeEach(() => {
  vi.clearAllMocks();
  for (const [name, value] of Object.entries(FULL_ENV)) vi.stubEnv(name, value);
  // Defaults that each test overrides as needed.
  vi.mocked(lib.runLeagueMails).mockResolvedValue({ planned: 1, sent: 1, failed: [], skipped: 0 });
  vi.mocked(lib.restMailStore).mockReturnValue({ optOut: vi.fn(() => Promise.resolve()) } as never);
  vi.mocked(lib.resendSender).mockReturnValue(() => Promise.resolve());
  vi.mocked(lib.verifyUnsubscribe).mockReturnValue(true);
});
afterEach(() => vi.unstubAllEnvs());

const req = (headers: Record<string, string> = {}) =>
  new Request("https://weft.example/api/league/emails", { headers });

describe("GET /api/league/emails", () => {
  it("401s when CRON_SECRET is unset", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const res = await emailsRoute.GET(req());
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("Unauthorized");
  });

  it("401s when the bearer is wrong", async () => {
    const res = await emailsRoute.GET(req({ authorization: "Bearer wrong" }));
    expect(res.status).toBe(401);
  });

  it("401s when the bearer is missing", async () => {
    const res = await emailsRoute.GET(req());
    expect(res.status).toBe(401);
  });

  it("503s when SUPABASE_SECRET_KEY is missing", async () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    const res = await emailsRoute.GET(req({ authorization: "Bearer cron" }));
    expect(res.status).toBe(503);
    expect(lib.runLeagueMails).not.toHaveBeenCalled();
  });

  it("503s when RESEND_API_KEY is missing", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const res = await emailsRoute.GET(req({ authorization: "Bearer cron" }));
    expect(res.status).toBe(503);
  });

  it("503s when LEAGUE_EMAIL_SECRET is missing", async () => {
    vi.stubEnv("LEAGUE_EMAIL_SECRET", "");
    const res = await emailsRoute.GET(req({ authorization: "Bearer cron" }));
    expect(res.status).toBe(503);
  });

  it("runs with NEXT_PUBLIC_SITE_URL when set, defaulting site to it", async () => {
    const res = await emailsRoute.GET(req({ authorization: "Bearer cron" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ planned: 1, sent: 1, failed: [], skipped: 0 });
    expect(lib.restMailStore).toHaveBeenCalledWith(expect.any(String), "sb_x");
    expect(lib.resendSender).toHaveBeenCalledWith("re_x");
    expect(lib.runLeagueMails).toHaveBeenCalledWith(
      expect.objectContaining({ origin: "https://dev.weft", secret: "le_x" }),
    );
  });

  it("falls back to https://weft.zip when NEXT_PUBLIC_SITE_URL is unset", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    const res = await emailsRoute.GET(req({ authorization: "Bearer cron" }));
    expect(res.status).toBe(200);
    expect(lib.runLeagueMails).toHaveBeenCalledWith(expect.objectContaining({ origin: "https://weft.zip" }));
  });

  it("logs failed entries and still returns 200", async () => {
    vi.mocked(lib.runLeagueMails).mockResolvedValueOnce({ planned: 3, sent: 1, failed: ["b", "c"], skipped: 1 });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await emailsRoute.GET(req({ authorization: "Bearer cron" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ planned: 3, sent: 1, failed: ["b", "c"], skipped: 1 });
    expect(error).toHaveBeenCalledWith("League emails: b; c");
    error.mockRestore();
  });

  it("502s and logs when the run throws", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(lib.runLeagueMails).mockRejectedValueOnce(new Error("down"));
    const res = await emailsRoute.GET(req({ authorization: "Bearer cron" }));
    expect(res.status).toBe(502);
    expect(await res.text()).toBe("Couldn't run the league emails");
    expect(error).toHaveBeenCalledWith("League emails: down");
    error.mockRestore();
  });
});

describe("GET /api/league/open", () => {
  it("302s to weft://league", () => {
    const res = openRoute.GET();
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("weft://league");
  });
});

describe("GET/POST /api/league/unsubscribe", () => {
  const url = (qs: string) => `https://weft.example/api/league/unsubscribe${qs}`;
  const getReq = (qs = "?u=user1&t=tok") => new Request(url(qs));
  const postReq = (qs = "?u=user1&t=tok") => new Request(url(qs), { method: "POST" });

  it("503s on GET when LEAGUE_EMAIL_SECRET is unset", async () => {
    vi.stubEnv("LEAGUE_EMAIL_SECRET", "");
    const res = await unsubRoute.GET(getReq());
    expect(res.status).toBe(503);
    expect(lib.verifyUnsubscribe).not.toHaveBeenCalled();
  });

  it("503s on GET when SUPABASE_SECRET_KEY is unset", async () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    const res = await unsubRoute.GET(getReq());
    expect(res.status).toBe(503);
  });

  it("503s on POST when not set up", async () => {
    vi.stubEnv("LEAGUE_EMAIL_SECRET", "");
    const res = await unsubRoute.POST(postReq());
    expect(res.status).toBe(503);
  });

  it("400s on GET when the user id is missing", async () => {
    const res = await unsubRoute.GET(new Request(url("?t=tok")));
    expect(res.status).toBe(400);
    expect(lib.verifyUnsubscribe).not.toHaveBeenCalled();
  });

  it("400s on GET when the token is missing", async () => {
    const res = await unsubRoute.GET(new Request(url("?u=user1")));
    expect(res.status).toBe(400);
    expect(lib.verifyUnsubscribe).not.toHaveBeenCalled();
  });

  it("400s on GET when verifyUnsubscribe rejects the token", async () => {
    vi.mocked(lib.verifyUnsubscribe).mockReturnValueOnce(false);
    const res = await unsubRoute.GET(getReq());
    expect(res.status).toBe(400);
    expect(lib.verifyUnsubscribe).toHaveBeenCalledWith("user1", "tok", "le_x");
  });

  it("400s on POST when verifyUnsubscribe rejects the token", async () => {
    vi.mocked(lib.verifyUnsubscribe).mockReturnValueOnce(false);
    const res = await unsubRoute.POST(postReq());
    expect(res.status).toBe(400);
  });

  it("GET shows the confirm page and does NOT opt out", async () => {
    const res = await unsubRoute.GET(getReq());
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Stop league emails?");
    expect(html).toContain('method="post"');
    expect(html).toContain("Stop league emails");
    expect(lib.restMailStore).not.toHaveBeenCalled();
  });

  it("POST calls optOut(userId) and shows the done page", async () => {
    const optOut = vi.fn(() => Promise.resolve());
    vi.mocked(lib.restMailStore).mockReturnValue({ optOut } as never);
    const res = await unsubRoute.POST(postReq("?u=user1&t=tok"));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("League emails are off");
    expect(lib.restMailStore).toHaveBeenCalledWith(expect.any(String), "sb_x");
    expect(optOut).toHaveBeenCalledWith("user1");
  });

  it("POST 502s and logs when optOut throws", async () => {
    const optOut = vi.fn(() => Promise.reject(new Error("db down")));
    vi.mocked(lib.restMailStore).mockReturnValue({ optOut } as never);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await unsubRoute.POST(postReq());
    expect(res.status).toBe(502);
    expect(await res.text()).toContain("Something went wrong");
    expect(error).toHaveBeenCalledWith("League unsubscribe: db down");
    error.mockRestore();
  });
});
