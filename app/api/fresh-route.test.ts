import { beforeEach, describe, expect, it, vi } from "vitest";

// POST /api/cards/:id/fresh: a cold card's message in a new session of the same card (lib/splice.ts).

const sendFresh = vi.fn();
vi.mock("@/lib/splice", () => ({ sendFresh }));

const route = await import("./cards/[id]/fresh/route");

function post(body: unknown, headers: Record<string, string> = { "x-weft-token": "1" }) {
  const req = new Request("http://localhost:3457/api/cards/c1/fresh", {
    method: "POST",
    headers: { host: "localhost:3457", "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return route.POST(req, { params: Promise.resolve({ id: "c1" }) });
}

beforeEach(() => {
  sendFresh.mockReset();
});

describe("POST /api/cards/:id/fresh", () => {
  it("sends the message fresh", async () => {
    sendFresh.mockResolvedValue(undefined);
    const res = await post({ message: "commit this" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(sendFresh).toHaveBeenCalledWith("c1", "commit this");
  });

  it("passes an empty message on, and reports a failure", async () => {
    sendFresh.mockRejectedValueOnce(new Error("Write a message first."));
    const res = await post({});
    expect(sendFresh).toHaveBeenCalledWith("c1", "");
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await res.json()).toMatchObject({ error: "Write a message first." });
  });

  it("refuses a write without the board's header", async () => {
    const res = await post({ message: "x" }, {});
    expect(res.status).toBe(403);
    expect(sendFresh).not.toHaveBeenCalled();
  });
});
