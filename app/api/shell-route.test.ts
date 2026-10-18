// The "!" route on its own file, as app/api/routes.test.ts is at its ratchet size.
import { beforeEach, describe, expect, it, vi } from "vitest";

const runShell = vi.hoisted(() => vi.fn());
vi.mock("@/lib/shell", () => ({ runShell }));
const route = await import("./cards/[id]/shell/route");

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (body: unknown, headers: Record<string, string> = { "x-weft-token": "1" }) =>
  new Request("http://localhost:3000/api/cards/c1/shell", {
    method: "POST",
    headers: { host: "localhost:3000", "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  runShell.mockReset();
});

describe("POST /cards/:id/shell", () => {
  it("starts the command in the card's folder", async () => {
    const res = await route.POST(post({ command: " git status " }), ctx("c1"));
    expect(await res.json()).toEqual({ ok: true });
    expect(runShell).toHaveBeenCalledWith("c1", "git status");
  });

  it("says why a command didn't run", async () => {
    runShell.mockImplementation(() => {
      throw new Error("Write a command after the !.");
    });
    const res = await route.POST(post({}), ctx("c1"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Write a command after the !." });
    expect(runShell).toHaveBeenCalledWith("c1", "");
  });

  it("refuses a write without Weft's header", async () => {
    const res = await route.POST(post({ command: "ls" }, {}), ctx("c1"));
    expect(res.status).toBe(403);
    expect(runShell).not.toHaveBeenCalled();
  });
});
