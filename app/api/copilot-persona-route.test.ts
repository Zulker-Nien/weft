import { beforeEach, describe, expect, it, vi } from "vitest";

// /api/copilot/persona: POST behind the localhost guard and x-threadboard, handing a known persona to
// lib/copilot (which starts a new chat on it) and turning anything else away.

vi.mock("@/lib/copilot", () => ({
  setCopilotPersona: vi.fn((persona: string) => Promise.resolve({ id: "copilot", role: "copilot", persona })),
}));

const lib = await import("@/lib/copilot");
const route = await import("./copilot/persona/route");

const URL = "http://localhost:3457/api/copilot/persona";
const WRITE = { host: "localhost:3457", "x-threadboard": "1", "content-type": "application/json" };
const post = (body: string, headers: Record<string, string> = WRITE) => route.POST(new Request(URL, { method: "POST", headers, body }));

beforeEach(() => vi.clearAllMocks());

describe("POST /api/copilot/persona", () => {
  it("switches to the persona and answers the fresh copilot", async () => {
    const res = await post(JSON.stringify({ persona: "captain" }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { card: unknown }).card).toMatchObject({ id: "copilot", persona: "captain" });
    expect(lib.setCopilotPersona).toHaveBeenCalledWith("captain");
  });

  it("refuses an unknown persona", async () => {
    const res = await post(JSON.stringify({ persona: "pirate" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Unknown persona" });
    expect(lib.setCopilotPersona).not.toHaveBeenCalled();
  });

  it("answers a body that isn't JSON, or a failed switch, with the reason", async () => {
    expect((await post("{")).status).toBe(400);
    vi.mocked(lib.setCopilotPersona).mockRejectedValueOnce(new Error("CLI gone"));
    const res = await post(JSON.stringify({ persona: "founder" }));
    expect(await res.json()).toEqual({ error: "CLI gone" });
  });

  it("needs the x-threadboard header", async () => {
    const res = await post(JSON.stringify({ persona: "founder" }), { host: "localhost:3457" });
    expect(res.status).toBe(403);
    expect(lib.setCopilotPersona).not.toHaveBeenCalled();
  });
});
