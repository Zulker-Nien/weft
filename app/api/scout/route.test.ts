import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/lib/scout", () => ({
  scoutState: vi.fn(() => ({ report: null, running: true })),
  markStarted: vi.fn(),
}));

const scout = await import("@/lib/scout");
const route = await import("./route");

const READ = { host: "localhost:3457" };
const WRITE = { ...READ, "x-threadboard": "1", "content-type": "application/json" };
const req = (url: string, init: RequestInit = {}) => new Request(`http://localhost:3457/api/scout${url}`, init);
const post = (body: unknown, headers: Record<string, string> = WRITE) =>
  route.POST(req("", { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/scout", () => {
  it("refuses a foreign host", async () => {
    expect((await route.GET(req("?cwd=/p", { headers: { host: "evil.com" } }))).status).toBe(403);
  });

  it("is null without a folder", async () => {
    expect(await (await route.GET(req("", { headers: READ }))).json()).toEqual({ scout: null });
    expect(scout.scoutState).not.toHaveBeenCalled();
  });

  it("returns the folder's scout state", async () => {
    const res = await route.GET(req("?cwd=%2Fp", { headers: READ }));
    expect(await res.json()).toEqual({ scout: { report: null, running: true } });
    expect(scout.scoutState).toHaveBeenCalledWith("/p");
  });

  it("fails with 500 when reading throws", async () => {
    vi.mocked(scout.scoutState).mockImplementationOnce(() => {
      throw new Error("disk");
    });
    const res = await route.GET(req("?cwd=/p", { headers: READ }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "disk" });
  });
});

describe("POST /api/scout", () => {
  it("needs the write header and a folder", async () => {
    expect((await post({ cwd: "/p" }, READ)).status).toBe(403);
    expect((await post({})).status).toBe(400);
    expect((await post({ cwd: 3 })).status).toBe(400);
  });

  it("forces a fresh run", async () => {
    await post({ cwd: "/p" });
    expect(scout.scoutState).toHaveBeenCalledWith("/p", { force: true });
    expect(scout.markStarted).not.toHaveBeenCalled();
  });

  it("marks a finding started without forcing a run", async () => {
    const res = await post({ cwd: "/p", started: "f1" });
    expect(scout.markStarted).toHaveBeenCalledWith("/p", "f1");
    expect(scout.scoutState).toHaveBeenCalledWith("/p", { force: false });
    expect(await res.json()).toEqual({ scout: { report: null, running: true } });
  });

  it("fails with 500 on a bad body", async () => {
    expect((await post("{nope")).status).toBe(500);
  });
});
