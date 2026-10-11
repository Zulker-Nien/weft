import { describe, expect, it, vi } from "vitest";

// /api/game: hands ?cwd= and &full=1 to lib/game-server and reports its failures.

vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/lib/game-server", () => ({ gameState: vi.fn(() => ({ xp: 5 })) }));

const server = await import("@/lib/game-server");
const route = await import("./game/route");

const READ = { host: "localhost:3457" };

describe("GET /api/game", () => {
  it("returns the game for the project in view", async () => {
    const res = await route.GET(new Request("http://localhost:3457/api/game?cwd=/dev/app&full=1", { headers: READ }));
    expect(await res.json()).toEqual({ game: { xp: 5 } });
    expect(server.gameState).toHaveBeenLastCalledWith({ cwd: "/dev/app", full: true });
    await route.GET(new Request("http://localhost:3457/api/game", { headers: READ }));
    expect(server.gameState).toHaveBeenLastCalledWith({ cwd: null, full: false });
  });

  it("refuses other hosts and reports errors", async () => {
    expect((await route.GET(new Request("http://evil.test/api/game", { headers: { host: "evil.test" } }))).status).toBe(403);
    vi.mocked(server.gameState).mockImplementationOnce(() => {
      throw new Error("boom");
    });
    const res = await route.GET(new Request("http://localhost:3457/api/game", { headers: READ }));
    expect(res.status).toBe(500);
  });
});
