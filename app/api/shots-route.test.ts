import { beforeEach, describe, expect, it, vi } from "vitest";

// /api/cards/[id]/shots: the show rail's page pictures. GET lists them or serves one, POST captures the
// page the pane settled on. lib/page-shots is mocked.

vi.mock("next/server", () => ({ connection: async () => {} }));

const shots = vi.hoisted(() => ({
  captureShot: vi.fn<(card: string, url: string) => Promise<boolean>>(),
  listShots: vi.fn<(card: string) => Record<string, string>>(),
  readShot: vi.fn<(card: string, name: string) => Buffer | undefined>(),
}));
vi.mock("@/lib/page-shots", () => shots);

const route = await import("./cards/[id]/shots/route");

const READ = { host: "localhost:3457" };
const WRITE = { ...READ, "x-weft-token": "1", "content-type": "application/json" };
const params = { params: Promise.resolve({ id: "c1" }) };
const req = (method: string, headers: Record<string, string>, query = "", body?: string) =>
  new Request(`http://localhost:3457/api/cards/c1/shots${query}`, { method, headers, body });
const MAP = { "http://localhost:3000/": "/api/cards/c1/shots?img=abc&v=1" };

beforeEach(() => {
  vi.clearAllMocks();
  shots.listShots.mockReturnValue(MAP);
  shots.captureShot.mockResolvedValue(true);
});

describe("GET /api/cards/[id]/shots", () => {
  it("lists the card's page pictures", async () => {
    const res = await route.GET(req("GET", READ), params);
    expect(await res.json()).toEqual({ shots: MAP });
    expect(shots.listShots).toHaveBeenCalledWith("c1");
  });

  it("serves one picture as WebP, and 404s one it doesn't have", async () => {
    shots.readShot.mockReturnValueOnce(Buffer.from("webp"));
    const res = await route.GET(req("GET", READ, "?img=abc"), params);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(await res.text()).toBe("webp");
    expect(shots.readShot).toHaveBeenCalledWith("c1", "abc");
    expect((await route.GET(req("GET", READ, "?img=nope"), params)).status).toBe(404);
  });

  it("refuses a foreign Host", async () => {
    expect((await route.GET(req("GET", { host: "evil.com" }), params)).status).toBe(403);
  });
});

describe("POST /api/cards/[id]/shots", () => {
  it("captures the page and returns the pictures", async () => {
    const res = await route.POST(req("POST", WRITE, "", JSON.stringify({ url: "http://localhost:3000/" })), params);
    expect(await res.json()).toEqual({ shots: MAP });
    expect(shots.captureShot).toHaveBeenCalledWith("c1", "http://localhost:3000/");
  });

  it("asks which page when there's none, and reports a failed capture", async () => {
    expect((await route.POST(req("POST", WRITE, "", "{}"), params)).status).toBe(400);
    expect((await route.POST(req("POST", WRITE, "", "not json"), params)).status).toBe(400);
    shots.captureShot.mockRejectedValueOnce(new Error("disk full"));
    const res = await route.POST(req("POST", WRITE, "", JSON.stringify({ url: "x" })), params);
    expect(await res.json()).toEqual({ error: "disk full" });
  });

  it("needs the x-weft-token header", async () => {
    expect((await route.POST(req("POST", READ, "", JSON.stringify({ url: "x" })), params)).status).toBe(403);
  });
});
