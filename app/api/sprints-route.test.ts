import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Sprint } from "@/lib/sprints";

// GET/POST/PATCH/DELETE /api/sprints (lib/sprint-store.ts, lib/guard.ts): the store is mocked so
// the route's guard and error mapping are the things under test.

const s: Sprint = { id: "s", name: "Sprint 1", cardIds: ["a"], createdAt: 1 };
const store = vi.hoisted(() => ({
  listSprints: vi.fn((): Sprint[] => []),
  saveSprint: vi.fn(),
  renameSprint: vi.fn(),
  removeSprint: vi.fn(),
}));
vi.mock("@/lib/sprint-store", () => store);

const route = await import("./sprints/route");
const WRITE = { host: "localhost:3457", "x-threadboard": "1", "content-type": "application/json" };
const make = (method: "GET" | "POST" | "PATCH" | "DELETE", body?: unknown, headers: Record<string, string> = WRITE) =>
  new Request("http://localhost:3457/api/sprints", { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });

beforeEach(() => {
  store.listSprints.mockReset().mockReturnValue([]);
  store.saveSprint.mockReset().mockReturnValue(s);
  store.renameSprint.mockReset().mockReturnValue(s);
  store.removeSprint.mockReset();
});

describe("GET /sprints", () => {
  it("returns the saved sprints, without the write header", async () => {
    store.listSprints.mockReturnValueOnce([s]);
    const res = route.GET(make("GET", undefined, { host: "localhost:3457" }));
    expect(await res.json()).toEqual({ sprints: [s] });
  });

  it("refuses a non-local host", () => {
    expect(route.GET(make("GET", undefined, { host: "evil.test" })).status).toBe(403);
  });
});

describe("POST /sprints", () => {
  it("saves the cards as a sprint", async () => {
    const res = await route.POST(make("POST", { cardIds: ["a"], name: "Launch" }));
    expect(store.saveSprint).toHaveBeenCalledWith(["a"], "Launch");
    expect(await res.json()).toEqual({ sprint: s });
  });

  it("needs the write header", async () => {
    const res = await route.POST(make("POST", { cardIds: ["a"] }, { host: "localhost:3457" }));
    expect(res.status).toBe(403);
  });

  it("turns a store error into a 400", async () => {
    store.saveSprint.mockImplementationOnce(() => {
      throw new Error("A sprint needs at least one card.");
    });
    const res = await route.POST(make("POST", { cardIds: [] }));
    expect(res.status).toBe(400);
  });
});

describe("PATCH /sprints", () => {
  it("renames it", async () => {
    const res = await route.PATCH(make("PATCH", { id: "s", name: "Polish" }));
    expect(store.renameSprint).toHaveBeenCalledWith("s", "Polish");
    expect(res.status).toBe(200);
  });

  it("needs the write header, and maps errors", async () => {
    expect((await route.PATCH(make("PATCH", { id: "s" }, { host: "localhost:3457" }))).status).toBe(403);
    store.renameSprint.mockImplementationOnce(() => {
      throw new Error("No such sprint.");
    });
    expect((await route.PATCH(make("PATCH", { id: "x", name: "y" }))).status).toBe(400);
  });
});

describe("DELETE /sprints", () => {
  it("removes it", async () => {
    const res = await route.DELETE(make("DELETE", { id: "s" }));
    expect(store.removeSprint).toHaveBeenCalledWith("s");
    expect(await res.json()).toEqual({ ok: true });
  });

  it("needs the write header, and maps errors", async () => {
    expect((await route.DELETE(make("DELETE", { id: "s" }, { host: "localhost:3457" }))).status).toBe(403);
    store.removeSprint.mockImplementationOnce(() => {
      throw new Error("No such sprint.");
    });
    expect((await route.DELETE(make("DELETE", { id: "x" }))).status).toBe(400);
  });
});
