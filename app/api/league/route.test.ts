import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/lib/league-sync", () => ({
  leagueView: vi.fn(() => Promise.resolve({ state: "signed-out" })),
  tierView: vi.fn(() => Promise.resolve({ state: "signed-out" })),
}));

const sync = await import("@/lib/league-sync");
const get = (host = "localhost:3457", query = "") => GET(new Request(`http://localhost:3457/api/league${query}`, { headers: { host } }));

beforeEach(() => vi.clearAllMocks());

describe("GET /api/league", () => {
  it("refuses a foreign host", async () => {
    expect((await get("evil.com")).status).toBe(403);
    expect(sync.leagueView).not.toHaveBeenCalled();
  });

  it("returns your league", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ league: { state: "signed-out" } });
  });

  it("returns a tier's leagues with ?tier", async () => {
    const res = await get(undefined, "?tier=2");
    expect(sync.tierView).toHaveBeenCalledWith(2);
    expect(sync.leagueView).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({ tier: { state: "signed-out" } });
  });

  it("is a 500 when reading throws", async () => {
    vi.mocked(sync.leagueView).mockRejectedValueOnce(new Error("broken"));
    expect((await get()).status).toBe(500);
  });
});
