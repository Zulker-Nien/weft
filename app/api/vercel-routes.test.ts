import os from "node:os";
import { beforeEach, describe, expect, it, vi } from "vitest";

// /api/vercel/hooks lists, adds and removes the team webhooks that pull Vercel env variables live; /api/vercel/webhook
// is where the deployed Weft takes Vercel's deliveries. lib/vercel-hooks and lib/vercel-relay are mocked; the guard and
// the folder check are real, so folders are ones that exist.

vi.mock("@/lib/vercel-hooks", () => ({
  hookedTeams: vi.fn(() => Promise.resolve({ signedIn: true, teams: ["team_abc"] })),
  addVercelHook: vi.fn(() => Promise.resolve({ team: "team_abc" })),
  removeVercelHook: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/lib/vercel-relay", () => ({
  handle: vi.fn(() => Promise.resolve(new Response("Saved"))),
  restStore: vi.fn(() => ({})),
}));

const hooks = await import("@/lib/vercel-hooks");
const relay = await import("@/lib/vercel-relay");
const hookRoute = await import("./vercel/hooks/route");
const webhook = await import("./vercel/webhook/route");

const URL = "http://localhost:3457/api/vercel/hooks";
const READ = { host: "localhost:3457" };
const WRITE = { host: "localhost:3457", "x-weft-token": "1", "content-type": "application/json" };
const FOLDER = os.tmpdir();

const send = (method: string, body: unknown, headers: Record<string, string> = WRITE) => new Request(URL, { method, headers, body: JSON.stringify(body) });

beforeEach(() => vi.clearAllMocks());

describe("GET /api/vercel/hooks", () => {
  it("says which teams have a pull webhook", async () => {
    const res = await hookRoute.GET(new Request(URL, { headers: WRITE }));
    expect(await res.json()).toEqual({ signedIn: true, teams: ["team_abc"] });
  });

  it("refuses other hosts and reports a failure", async () => {
    // A read needs no x-weft-token header, only localhost.
    expect((await hookRoute.GET(new Request(URL, { headers: READ }))).status).toBe(200);
    expect((await hookRoute.GET(new Request("http://evil.test/api/vercel/hooks", { headers: { host: "evil.test" } }))).status).toBe(403);
    vi.mocked(hooks.hookedTeams).mockRejectedValueOnce(new Error("offline"));
    const res = await hookRoute.GET(new Request(URL, { headers: WRITE }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("offline");
  });
});

describe("POST and DELETE /api/vercel/hooks", () => {
  it("adds and removes the folder's team webhook", async () => {
    expect(await (await hookRoute.POST(send("POST", { folder: FOLDER }))).json()).toEqual({ team: "team_abc" });
    expect(hooks.addVercelHook).toHaveBeenCalledWith(FOLDER);
    expect(await (await hookRoute.DELETE(send("DELETE", { folder: FOLDER }))).json()).toEqual({ ok: true });
    expect(hooks.removeVercelHook).toHaveBeenCalledWith(FOLDER);
  });

  it("says why a webhook couldn't be added or removed", async () => {
    vi.mocked(hooks.addVercelHook).mockRejectedValueOnce(new Error("Vercel webhooks belong to a team: link a project in a team (Pro or Enterprise)."));
    const res = await hookRoute.POST(send("POST", { folder: FOLDER }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch("belong to a team");
    vi.mocked(hooks.removeVercelHook).mockRejectedValueOnce(new Error("nope"));
    expect((await hookRoute.DELETE(send("DELETE", { folder: FOLDER }))).status).toBe(400);
  });

  it("refuses a missing folder and a write without the header", async () => {
    expect((await hookRoute.POST(send("POST", { folder: "/no/such/folder" }))).status).toBe(400);
    expect((await hookRoute.DELETE(send("DELETE", {}))).status).toBe(400);
    expect((await hookRoute.POST(send("POST", { folder: FOLDER }, READ))).status).toBe(403);
    expect((await hookRoute.DELETE(send("DELETE", { folder: FOLDER }, READ))).status).toBe(403);
    expect(hooks.addVercelHook).not.toHaveBeenCalled();
    expect(hooks.removeVercelHook).not.toHaveBeenCalled();
  });
});

describe("POST /api/vercel/webhook", () => {
  const delivery = () => new Request("https://weft.example/api/vercel/webhook?hook=x", { method: "POST", headers: { host: "weft.example" }, body: "{}" });

  it("says when the relay isn't set up, with no localhost guard in the way", async () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    const res = await webhook.POST(delivery());
    expect(res.status).toBe(503);
    expect(relay.handle).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("hands the delivery to the relay with a store on Weft's Supabase", async () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_x");
    const res = await webhook.POST(delivery());
    expect(res.status).toBe(200);
    expect(relay.restStore).toHaveBeenCalledWith(expect.stringContaining("supabase.co"), "sb_secret_x");
    vi.unstubAllEnvs();
  });

  it("answers 502 when Supabase fails", async () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_x");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(relay.handle).mockRejectedValueOnce(new Error("Supabase 500: down"));
    expect((await webhook.POST(delivery())).status).toBe(502);
    expect(error).toHaveBeenCalledWith("Vercel webhook: Supabase 500: down");
    error.mockRestore();
    vi.unstubAllEnvs();
  });
});
