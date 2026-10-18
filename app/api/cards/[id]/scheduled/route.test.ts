import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/scheduler", () => ({
  scheduleMessage: vi.fn((id: string, text: string, at: number) => ({ id, scheduled: [{ id: "m1", text, at }] })),
  unscheduleMessage: vi.fn((id: string, messageId: string) => ({ id, removed: messageId })),
}));

const scheduler = await import("@/lib/scheduler");
const { POST, DELETE } = await import("./route");

const WRITE = { host: "localhost:3000", "x-weft-token": "1", "content-type": "application/json" };
const ctx = (id = "c1") => ({ params: Promise.resolve({ id }) });
const req = (method: string, body: unknown, headers: Record<string, string> = WRITE) =>
  new Request("http://localhost/api/cards/c1/scheduled", { method, headers, body: JSON.stringify(body) });

beforeEach(() => vi.clearAllMocks());

describe("POST /api/cards/[id]/scheduled", () => {
  it("queues the trimmed text at the given time and returns the card", async () => {
    const res = await POST(req("POST", { text: "  ship it  ", at: 5000 }), ctx());
    expect(res.status).toBe(200);
    expect(scheduler.scheduleMessage).toHaveBeenCalledWith("c1", "ship it", 5000);
    expect(await res.json()).toEqual({ card: { id: "c1", scheduled: [{ id: "m1", text: "ship it", at: 5000 }] } });
  });

  it("coerces a string time to a number and a missing one to NaN for the scheduler to refuse", async () => {
    await POST(req("POST", { text: "hi", at: "7000" }), ctx());
    expect(scheduler.scheduleMessage).toHaveBeenLastCalledWith("c1", "hi", 7000);
    await POST(req("POST", { text: "hi" }), ctx());
    expect(scheduler.scheduleMessage).toHaveBeenLastCalledWith("c1", "hi", NaN);
  });

  it("refuses a blank message with 400", async () => {
    for (const body of [{ at: 1 }, { text: "   ", at: 1 }]) {
      const res = await POST(req("POST", body), ctx());
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Write a message first." });
    }
    expect(scheduler.scheduleMessage).not.toHaveBeenCalled();
  });

  it("turns a scheduler error into a 400 with its message", async () => {
    vi.mocked(scheduler.scheduleMessage).mockImplementationOnce(() => {
      throw new Error("That time has already passed.");
    });
    const res = await POST(req("POST", { text: "hi", at: 1 }), ctx());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "That time has already passed." });
  });

  it("returns 400 for a body that isn't JSON", async () => {
    const res = await POST(new Request("http://localhost/x", { method: "POST", headers: WRITE, body: "nope" }), ctx());
    expect(res.status).toBe(400);
  });

  it("is guarded: no x-weft-token header or a foreign host is 403", async () => {
    expect((await POST(req("POST", { text: "hi", at: 1 }, { host: "localhost" }), ctx())).status).toBe(403);
    expect((await POST(req("POST", { text: "hi", at: 1 }, { ...WRITE, host: "evil.com" }), ctx())).status).toBe(403);
    expect(scheduler.scheduleMessage).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/cards/[id]/scheduled", () => {
  it("takes the named message back", async () => {
    const res = await DELETE(req("DELETE", { messageId: "m1" }), ctx("c2"));
    expect(scheduler.unscheduleMessage).toHaveBeenCalledWith("c2", "m1");
    expect(await res.json()).toEqual({ card: { id: "c2", removed: "m1" } });
  });

  it("asks which message when none is given", async () => {
    const res = await DELETE(req("DELETE", {}), ctx());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Which message?" });
    expect(scheduler.unscheduleMessage).not.toHaveBeenCalled();
  });

  it("turns a scheduler error into a 400", async () => {
    vi.mocked(scheduler.unscheduleMessage).mockImplementationOnce(() => {
      throw new Error("No such card.");
    });
    const res = await DELETE(req("DELETE", { messageId: "m1" }), ctx("gone"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "No such card." });
  });

  it("is guarded", async () => {
    expect((await DELETE(req("DELETE", { messageId: "m1" }, { host: "localhost" }), ctx())).status).toBe(403);
    expect(scheduler.unscheduleMessage).not.toHaveBeenCalled();
  });
});
