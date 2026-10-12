import { beforeEach, describe, expect, it, vi } from "vitest";

// The account routes with lib/account mocked: the view, each POST action, and the browser callback page.

vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/lib/account", () => ({
  accountView: vi.fn(() => Promise.resolve({ configured: true, user: null })),
  startSignIn: vi.fn(() => Promise.resolve("https://github.com/login")),
  sendMagicLink: vi.fn(async () => {}),
  signOut: vi.fn(async () => {}),
  finishSignIn: vi.fn(() => Promise.resolve({ id: "u1", email: "a@b.co", name: "Ada", avatar: null, provider: "github" })),
}));

const account = await import("@/lib/account");
const route = await import("./account/route");
const callback = await import("./account/callback/route");

const WRITE = { host: "127.0.0.1:3457", "x-threadboard": "1", "content-type": "application/json" };

function post(body: unknown, headers: Record<string, string> = WRITE) {
  return route.POST(new Request("http://127.0.0.1:3457/api/account", { method: "POST", headers, body: JSON.stringify(body) }));
}

function back(query: string, host = "127.0.0.1:3457") {
  return callback.GET(new Request(`http://${host}/api/account/callback${query}`, { headers: { host } }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /account", () => {
  it("returns the view", async () => {
    const res = await route.GET(new Request("http://localhost/api/account", { headers: { host: "localhost:3457" } }));
    expect(await res.json()).toEqual({ configured: true, user: null });
  });

  it("refuses other hosts and reports failures", async () => {
    expect((await route.GET(new Request("http://evil/api/account", { headers: { host: "evil.com" } }))).status).toBe(403);
    vi.mocked(account.accountView).mockRejectedValueOnce(new Error("disk"));
    const res = await route.GET(new Request("http://localhost/api/account", { headers: { host: "localhost" } }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "disk" });
  });
});

describe("POST /account", () => {
  it("starts OAuth back to the origin the board used", async () => {
    expect(await (await post({ action: "oauth", provider: "github" })).json()).toEqual({ url: "https://github.com/login" });
    expect(account.startSignIn).toHaveBeenCalledWith("github", "http://127.0.0.1:3457");
  });

  it("sends a magic link and signs out", async () => {
    expect((await post({ action: "email", email: "a@b.co" })).status).toBe(200);
    expect(account.sendMagicLink).toHaveBeenCalledWith("a@b.co", "http://127.0.0.1:3457");
    expect((await post({ action: "signout" })).status).toBe(200);
    expect(account.signOut).toHaveBeenCalled();
  });

  it("passes empty text for missing fields and refuses unknown actions", async () => {
    await post({ action: "email", email: 5 });
    expect(account.sendMagicLink).toHaveBeenCalledWith("", "http://127.0.0.1:3457");
    const res = await post({ action: "hack" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Unknown account action." });
  });

  it("needs the write header", async () => {
    expect((await post({ action: "signout" }, { host: "127.0.0.1:3457" })).status).toBe(403);
  });
});

describe("GET /account/callback", () => {
  it("finishes sign-in and leaves a friendly page", async () => {
    const res = await back("?code=abc");
    expect(account.finishSignIn).toHaveBeenCalledWith("abc");
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("You&#39;re signed in as a@b.co.");
  });

  it("falls back to the name, or no one", async () => {
    vi.mocked(account.finishSignIn).mockResolvedValueOnce({ id: "u", email: null, name: "Ada", avatar: null, provider: null });
    expect(await (await back("?code=a")).text()).toContain("signed in as Ada");
    vi.mocked(account.finishSignIn).mockResolvedValueOnce({ id: "u", email: null, name: null, avatar: null, provider: null });
    const text = await (await back("")).text();
    expect(text).toContain("Signed in to Weft");
    expect(text).not.toContain("signed in as");
    expect(account.finishSignIn).toHaveBeenLastCalledWith("");
  });

  it("shows the provider's error, escaped", async () => {
    const res = await back("?error=access_denied&error_description=%3Cb%3Enope%3C%2Fb%3E");
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toContain("&#60;b&#62;nope");
    expect(account.finishSignIn).not.toHaveBeenCalled();
    expect(await (await back("?error=denied")).text()).toContain("denied");
  });

  it("shows exchange failures", async () => {
    vi.mocked(account.finishSignIn).mockRejectedValueOnce(new Error("expired"));
    expect(await (await back("?code=old")).text()).toContain("expired");
    vi.mocked(account.finishSignIn).mockRejectedValueOnce("weird");
    expect(await (await back("?code=old")).text()).toContain("weird");
  });

  it("only answers on this machine", async () => {
    expect((await back("?code=a", "evil.com")).status).toBe(403);
  });
});
