import { afterEach, describe, expect, it, vi } from "vitest";

// /api/hooks/<relay id>[/path][?query] is the webhook relay's public URL on the deployed Weft: no localhost guard,
// every method a provider uses, and what follows the id is handed on as the delivery's path. lib/webhook-relay is mocked.

vi.mock("@/lib/webhook-relay", () => ({
  handle: vi.fn<(req: Request, id: string, extra: string, store: unknown) => Promise<Response>>(() => Promise.resolve(new Response("Relayed"))),
  restStore: vi.fn(() => ({})),
}));

const relay = await import("@/lib/webhook-relay");
const route = await import("./hooks/[id]/[[...rest]]/route");

const ID = "6f1c2a7e-0b8d-4c3e-9a51-2d7f00c1b9aa";
const ctx = { params: Promise.resolve({ id: ID }) };
const call = (path: string, method = "POST") => new Request(`https://weft.example/api/hooks/${ID}${path}`, { method, headers: { host: "weft.example" }, body: method === "GET" ? undefined : "{}" });

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("/api/hooks/[id]/[[...rest]]", () => {
  it("says when the relay isn't set up, with no localhost guard in the way", async () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    expect((await route.POST(call(""), ctx)).status).toBe(503);
    expect(relay.handle).not.toHaveBeenCalled();
  });

  it("hands every method to the relay with the path and query after the id, and a store on Weft's Supabase", async () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_x");
    for (const [fn, method] of [[route.GET, "GET"], [route.POST, "POST"], [route.PUT, "PUT"], [route.PATCH, "PATCH"], [route.DELETE, "DELETE"]] as const) {
      expect((await fn(call("", method), ctx)).status).toBe(200);
    }
    expect(relay.restStore).toHaveBeenCalledWith(expect.stringContaining("supabase.co"), "sb_secret_x");
    const extras = vi.mocked(relay.handle).mock.calls.map((c) => c[2]);
    expect(extras).toEqual(["", "", "", "", ""]);
    await route.POST(call("/sub/x%20y?foo=1&bar=2"), ctx);
    await route.POST(call("?foo=1"), ctx);
    expect(vi.mocked(relay.handle).mock.calls.slice(-2).map((c) => [c[1], c[2]])).toEqual([
      [ID, "/sub/x%20y?foo=1&bar=2"],
      [ID, "?foo=1"],
    ]);
  });

  it("answers 502 when Supabase fails", async () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_x");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(relay.handle).mockRejectedValueOnce(new Error("Supabase 500: down"));
    expect((await route.POST(call(""), ctx)).status).toBe(502);
    expect(error).toHaveBeenCalledWith("Webhook relay: Supabase 500: down");
    error.mockRestore();
  });
});
