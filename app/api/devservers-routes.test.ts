import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ connection: async () => {} }));

vi.mock("@/lib/devserver", () => ({
  stopDev: vi.fn(),
  restartDev: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/lib/devserver-list", () => ({
  listDev: vi.fn(() => Promise.resolve([{ cardId: "c1", cwd: "/p", command: "npm run dev", state: "running", startedAt: 1, source: "weft" }])),
}));

vi.mock("@/lib/task-stop", () => ({ stopTask: vi.fn(() => Promise.resolve()) }));

const dev = await import("@/lib/devserver");
const devList = await import("@/lib/devserver-list");
const taskStop = await import("@/lib/task-stop");
const route = await import("./devservers/route");

const WRITE = { host: "localhost:3457", "x-weft-token": "1", "content-type": "application/json" };

function req(url: string, { method = "GET", body, headers = WRITE }: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  return new Request(`http://localhost:3457/api${url}`, {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /devservers", () => {
  it("lists every dev server Weft knows about, without needing x-weft-token", async () => {
    const res = await route.GET(req("/devservers", { headers: { host: "localhost:3457" } }));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { servers: { cardId: string; source: string }[] };
    expect(json.servers).toEqual([{ cardId: "c1", cwd: "/p", command: "npm run dev", state: "running", startedAt: 1, source: "weft" }]);
    expect(devList.listDev).toHaveBeenCalled();
  });

  it("rejects a foreign host", async () => {
    const res = await route.GET(req("/devservers", { headers: { host: "attacker.test" } }));
    expect(res.status).toBe(403);
  });
});

describe("POST /devservers", () => {
  const post = (body: unknown) => route.POST(req("/devservers", { method: "POST", body }));

  it("stops a thread task when taskId is given", async () => {
    expect((await post({ action: "stop", cardId: "c1", taskId: "tk" })).status).toBe(200);
    expect(taskStop.stopTask).toHaveBeenCalledWith("c1", "tk");
    expect(dev.stopDev).not.toHaveBeenCalled();
  });

  it("stops the Weft run for the card when no taskId", async () => {
    expect((await post({ action: "stop", cardId: "c1" })).status).toBe(200);
    expect(dev.stopDev).toHaveBeenCalledWith("c1");
  });

  it("restart stops then restarts the Weft run", async () => {
    expect((await post({ action: "restart", cardId: "c1" })).status).toBe(200);
    expect(dev.restartDev).toHaveBeenCalledWith("c1");
  });

  it("400s a missing cardId, an unknown action, or bad JSON", async () => {
    for (const body of [{ action: "stop" }, { action: "hack", cardId: "c1" }, "{"]) {
      expect((await post(body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(dev.stopDev).not.toHaveBeenCalled();
    expect(dev.restartDev).not.toHaveBeenCalled();
    expect(taskStop.stopTask).not.toHaveBeenCalled();
  });

  it("rejects a foreign host and a write without x-weft-token", async () => {
    const foreignRes = await route.POST(req("/devservers", { method: "POST", body: { action: "stop", cardId: "c1" }, headers: { host: "evil.com", "x-weft-token": "1", "content-type": "application/json" } }));
    expect(foreignRes.status).toBe(403);
    const noHeaderRes = await route.POST(req("/devservers", { method: "POST", body: { action: "stop", cardId: "c1" }, headers: { host: "localhost:3457", "content-type": "application/json" } }));
    expect(noHeaderRes.status).toBe(403);
    expect(dev.stopDev).not.toHaveBeenCalled();
    expect(taskStop.stopTask).not.toHaveBeenCalled();
  });
});
