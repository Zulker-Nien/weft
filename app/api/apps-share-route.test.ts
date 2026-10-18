import { describe, expect, it, vi } from "vitest";

// /api/apps/share: GET ?id=<appId> reads the app's share state, PUT { id, mode, password? } writes a new one.
// The localhost guard (write also needs x-weft-token) wraps both, and the lib's AppShareError is passed
// through verbatim while any other error becomes a 500.

vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/lib/app-share", () => {
  class AppShareError extends Error {
    constructor(
      message: string,
      readonly status: number,
    ) {
      super(message);
    }
  }
  return {
    AppShareError,
    getAppShare: vi.fn(() => Promise.resolve({ kind: "ok", id: "s1", url: "https://weft.zip/a/s1", mode: "public", hasPassword: false, shows: "blob" })),
    setAppShare: vi.fn(() => Promise.resolve({ kind: "ok", id: "s1", url: "https://weft.zip/a/s1", mode: "password", hasPassword: true, shows: "blob" })),
  };
});

const lib = await import("@/lib/app-share");
const route = await import("./apps/share/route");

const READ = { host: "localhost:3457" };
const WRITE = { host: "localhost:3457", "x-weft-token": "1", "content-type": "application/json" };
const put = (body: string, headers: Record<string, string> = WRITE) => route.PUT(new Request("http://localhost:3457/api/apps/share", { method: "PUT", headers, body }));

describe("GET /api/apps/share", () => {
  it("answers the app's share state", async () => {
    const res = await route.GET(new Request("http://localhost:3457/api/apps/share?id=ap1", { headers: READ }));
    expect(await res.json()).toEqual({ kind: "ok", id: "s1", url: "https://weft.zip/a/s1", mode: "public", hasPassword: false, shows: "blob" });
    expect(lib.getAppShare).toHaveBeenLastCalledWith("ap1");
  });

  it("refuses other hosts", async () => {
    const res = await route.GET(new Request("http://evil.test/api/apps/share?id=ap1", { headers: { host: "evil.test" } }));
    expect(res.status).toBe(403);
  });

  it("answers 400 when the id query is missing", async () => {
    const res = await route.GET(new Request("http://localhost:3457/api/apps/share", { headers: READ }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Send ?id=." });
  });

  it("passes an AppShareError status through", async () => {
    vi.mocked(lib.getAppShare).mockRejectedValueOnce(new lib.AppShareError("No such app.", 404));
    const res = await route.GET(new Request("http://localhost:3457/api/apps/share?id=missing", { headers: READ }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "No such app." });
  });

  it("turns other errors into 500", async () => {
    vi.mocked(lib.getAppShare).mockRejectedValueOnce(new Error("supabase down"));
    const res = await route.GET(new Request("http://localhost:3457/api/apps/share?id=ap1", { headers: READ }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "supabase down" });
  });
});

describe("PUT /api/apps/share", () => {
  it("saves the mode and password and answers the new state", async () => {
    const res = await put(JSON.stringify({ id: "ap1", mode: "password", password: "pw" }));
    expect(await res.json()).toMatchObject({ kind: "ok", mode: "password", hasPassword: true });
    expect(lib.setAppShare).toHaveBeenLastCalledWith("ap1", { mode: "password", password: "pw" });
  });

  it("needs the write header, a JSON body and a string id", async () => {
    expect((await put("{}", { host: "localhost:3457", "content-type": "application/json" })).status).toBe(403);
    const badJson = await put("not json");
    expect(badJson.status).toBe(400);
    expect(await badJson.json()).toEqual({ error: "Send { id, mode, password? }." });
    const missingId = await put(JSON.stringify({ mode: "public" }));
    expect(missingId.status).toBe(400);
    expect(await missingId.json()).toEqual({ error: "Send { id, mode, password? }." });
  });

  it("passes a refusal's status through", async () => {
    vi.mocked(lib.setAppShare).mockRejectedValueOnce(new lib.AppShareError("Set a password first.", 400));
    const res = await put(JSON.stringify({ id: "ap1", mode: "password" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Set a password first." });
  });

  it("turns other errors into 500", async () => {
    vi.mocked(lib.setAppShare).mockRejectedValueOnce(new Error("supabase down"));
    const res = await put(JSON.stringify({ id: "ap1", mode: "public" }));
    expect(res.status).toBe(500);
  });
});
