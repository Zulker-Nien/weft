import { describe, expect, it, vi } from "vitest";

// /api/limits: one CLI's plan-limit history from lib/limit-history, for the burndown chart.

vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/lib/limit-history", () => ({
  readSamples: vi.fn(() => [
    { at: 1, backend: "claude", kind: "five_hour", used: 5 },
    { at: 2, backend: "puku", kind: "five_hour", used: 9 },
  ]),
}));

const history = await import("@/lib/limit-history");
const route = await import("./limits/route");

const READ = { host: "localhost:3457" };

describe("GET /api/limits", () => {
  it("returns the samples of the CLI asked for, Claude Code by default", async () => {
    const claude = await route.GET(new Request("http://localhost:3457/api/limits", { headers: READ }));
    expect(await claude.json()).toEqual({ samples: [{ at: 1, backend: "claude", kind: "five_hour", used: 5 }] });
    const puku = await route.GET(new Request("http://localhost:3457/api/limits?backend=puku", { headers: READ }));
    expect(await puku.json()).toEqual({ samples: [{ at: 2, backend: "puku", kind: "five_hour", used: 9 }] });
  });

  it("refuses other hosts and reports errors", async () => {
    expect((await route.GET(new Request("http://evil.test/api/limits", { headers: { host: "evil.test" } }))).status).toBe(403);
    vi.mocked(history.readSamples).mockImplementationOnce(() => {
      throw new Error("boom");
    });
    expect((await route.GET(new Request("http://localhost:3457/api/limits", { headers: READ }))).status).toBe(500);
  });
});
