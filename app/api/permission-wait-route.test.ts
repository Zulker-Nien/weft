import { describe, expect, it, vi } from "vitest";

// POST /api/cards/:id/permission with wait: true holds a symbol-claim prompt (lib/permission-wait.ts).
// The rest of the route is covered in routes.test.ts; lib/runner is mocked.

const runner = vi.hoisted(() => ({ answerPermission: vi.fn(), waitPermission: vi.fn() }));
vi.mock("@/lib/runner", () => runner);

const route = await import("./cards/[id]/permission/route");
const WRITE = { host: "localhost:3457", "x-threadboard": "1", "content-type": "application/json" };
const post = (body: unknown) =>
  route.POST(new Request("http://localhost:3457/api/cards/c1/permission", { method: "POST", headers: WRITE, body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: "c1" }),
  });

describe("POST /cards/:id/permission { wait }", () => {
  it("holds the request by pendingId without answering it", async () => {
    expect(await (await post({ wait: true, pendingId: "p1" })).json()).toEqual({ ok: true });
    expect(runner.waitPermission).toHaveBeenCalledWith("c1", "p1");
    expect(runner.answerPermission).not.toHaveBeenCalled();
  });

  it("needs the pendingId", async () => {
    expect((await post({ wait: true })).status).toBe(409);
  });
});
