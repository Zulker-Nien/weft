// The task strip's Stop route on its own file, as app/api/routes.test.ts is at its ratchet size.
import { beforeEach, describe, expect, it, vi } from "vitest";

const stopTask = vi.hoisted(() => vi.fn());
vi.mock("@/lib/task-stop", () => ({ stopTask }));
const route = await import("./cards/[id]/tasks/[taskId]/stop/route");

const ctx = { params: Promise.resolve({ id: "c1", taskId: "t1" }) };
const post = (headers: Record<string, string> = { "x-threadboard": "1" }) =>
  new Request("http://localhost:3000/api/cards/c1/tasks/t1/stop", { method: "POST", headers: { host: "localhost:3000", ...headers } });

beforeEach(() => {
  stopTask.mockReset();
});

describe("POST /cards/:id/tasks/:taskId/stop", () => {
  it("stops the card's task", async () => {
    const res = await route.POST(post(), ctx);
    expect(await res.json()).toEqual({ ok: true });
    expect(stopTask).toHaveBeenCalledWith("c1", "t1");
  });

  it("says why it couldn't", async () => {
    stopTask.mockRejectedValue(new Error("The CLI went away."));
    const res = await route.POST(post(), ctx);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "The CLI went away." });
  });

  it("refuses a write without Weft's header", async () => {
    const res = await route.POST(post({}), ctx);
    expect(res.status).toBe(403);
    expect(stopTask).not.toHaveBeenCalled();
  });
});
