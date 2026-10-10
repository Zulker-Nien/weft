import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/lib/search", () => ({ searchPrompts: vi.fn() }));

const { searchPrompts } = await import("@/lib/search");
const { GET } = await import("./route");

const get = (query = "", host = "localhost:3000") => GET(new Request(`http://localhost:3000/api/search${query}`, { headers: { host } }));

beforeEach(() => {
  vi.mocked(searchPrompts).mockReset();
});

describe("GET /api/search", () => {
  it("returns the matching prompts, without needing the write header", async () => {
    const result = { hits: [{ cardId: "c1", at: 5, snippet: "fix \u0001build\u0002" }], indexing: false };
    vi.mocked(searchPrompts).mockReturnValue(result);
    const res = await get("?q=build");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(result);
    expect(searchPrompts).toHaveBeenCalledWith("build");
  });

  it("searches for nothing when q is missing", async () => {
    vi.mocked(searchPrompts).mockReturnValue({ hits: [], indexing: true });
    expect(await (await get()).json()).toEqual({ hits: [], indexing: true });
    expect(searchPrompts).toHaveBeenCalledWith("");
  });

  it("refuses a request from another host", async () => {
    const res = await get("?q=x", "evil.example");
    expect(res.status).toBe(403);
    expect(searchPrompts).not.toHaveBeenCalled();
  });

  it("answers 500 with the message when the search fails", async () => {
    vi.mocked(searchPrompts).mockImplementation(() => {
      throw new Error("database is locked");
    });
    const res = await get("?q=x");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "database is locked" });
  });
});
