import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RestartStatus } from "@/lib/types";

// /api/restart: GET what a restart waits on, POST arms it, DELETE cancels it and sends the messages it held.
// lib/restart-when-idle and lib/scheduler are mocked.

vi.mock("next/server", () => ({ connection: async () => {} }));

const restart = vi.hoisted(() => ({
  armRestart: vi.fn<(then?: string) => RestartStatus>(),
  cancelRestart: vi.fn<() => RestartStatus>(),
  restartStatus: vi.fn<() => RestartStatus>(),
}));
vi.mock("@/lib/restart-when-idle", () => restart);
vi.mock("@/lib/scheduler", () => ({ sendDueMessages: vi.fn() }));

const { sendDueMessages } = await import("@/lib/scheduler");
const route = await import("./restart/route");

const status: RestartStatus = { armed: true, then: "relaunch", waiting: [{ id: "c1", title: "Fix it" }] };
const READ = { host: "localhost:3457" };
const WRITE = { ...READ, "x-weft-token": "1", "content-type": "application/json" };
const req = (method: string, headers: Record<string, string>, body?: string) => new Request("http://localhost:3457/api/restart", { method, headers, body });

beforeEach(() => {
  vi.clearAllMocks();
  restart.armRestart.mockReturnValue(status);
  restart.cancelRestart.mockReturnValue({ armed: false, waiting: [] });
  restart.restartStatus.mockReturnValue(status);
});

describe("GET /api/restart", () => {
  it("returns the status, with no x-weft-token header needed", async () => {
    const res = await route.GET(req("GET", READ));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(status);
  });

  it("refuses a foreign Host", async () => {
    expect((await route.GET(req("GET", { host: "evil.com" }))).status).toBe(403);
    expect(restart.restartStatus).not.toHaveBeenCalled();
  });
});

describe("POST /api/restart", () => {
  it("arms a relaunch by default, including with no body", async () => {
    expect(await (await route.POST(req("POST", WRITE))).json()).toEqual(status);
    expect(restart.armRestart).toHaveBeenLastCalledWith("relaunch");
    await route.POST(req("POST", WRITE, "not json"));
    expect(restart.armRestart).toHaveBeenLastCalledWith("relaunch");
    await route.POST(req("POST", WRITE, JSON.stringify({ then: "other" })));
    expect(restart.armRestart).toHaveBeenLastCalledWith("relaunch");
  });

  it("arms an update when asked", async () => {
    await route.POST(req("POST", WRITE, JSON.stringify({ then: "update" })));
    expect(restart.armRestart).toHaveBeenCalledWith("update");
  });

  it("answers 400 with the reason when it can't arm", async () => {
    restart.armRestart.mockImplementation(() => {
      throw new Error("Restarting Weft needs the desktop app.");
    });
    const res = await route.POST(req("POST", WRITE));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Restarting Weft needs the desktop app." });
  });

  it("rejects a write without x-weft-token", async () => {
    const res = await route.POST(req("POST", READ));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Missing x-weft-token header" });
    expect(restart.armRestart).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/restart", () => {
  it("cancels, then sends the messages it held, and returns the status", async () => {
    const order: string[] = [];
    restart.cancelRestart.mockImplementation(() => (order.push("cancel"), { armed: false, waiting: [] }));
    vi.mocked(sendDueMessages).mockImplementation(() => void order.push("send"));
    const res = route.DELETE(req("DELETE", WRITE));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ armed: false, waiting: [] });
    expect(order).toEqual(["cancel", "send"]);
  });

  it("rejects a write without x-weft-token", () => {
    expect(route.DELETE(req("DELETE", READ)).status).toBe(403);
    expect(restart.cancelRestart).not.toHaveBeenCalled();
    expect(sendDueMessages).not.toHaveBeenCalled();
  });
});
