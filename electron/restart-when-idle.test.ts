import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { armRestart, restartFor } from "./restart-when-idle.cjs";

const server = { url: "http://127.0.0.1:3457" };

describe("armRestart", () => {
  it("says so when the server isn't running, without calling it", async () => {
    const fetchImpl = vi.fn();
    expect(await armRestart(null, "relaunch", fetchImpl)).toBe("Weft's server isn't running.");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("posts what to do after to the server's /api/restart and resolves null when armed", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true });
    expect(await armRestart(server, "update", fetchImpl)).toBeNull();
    expect(fetchImpl).toHaveBeenCalledWith("http://127.0.0.1:3457/api/restart", {
      method: "POST",
      headers: { "content-type": "application/json", "x-weft-token": "1" },
      body: JSON.stringify({ then: "update" }),
    });
  });

  it("defaults to a relaunch", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true });
    await armRestart(server, undefined, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ body: JSON.stringify({ then: "relaunch" }) }));
  });

  it("returns the error from the response body", async () => {
    const res = { ok: false, status: 400, statusText: "Bad Request", json: () => Promise.resolve({ error: "Restarting Weft needs the desktop app." }) };
    expect(await armRestart(server, "relaunch", vi.fn().mockResolvedValue(res))).toBe("Restarting Weft needs the desktop app.");
  });

  it("falls back to the status text, then the status code, when the body has no error", async () => {
    const noBody = () => Promise.reject(new Error("not json"));
    expect(await armRestart(server, "relaunch", vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: "Server Error", json: noBody }))).toBe("Server Error");
    expect(await armRestart(server, "relaunch", vi.fn().mockResolvedValue({ ok: false, status: 502, statusText: "", json: () => Promise.resolve({}) }))).toBe("HTTP 502");
  });

  it("returns the message when fetch throws, or the error itself when it has none", async () => {
    expect(await armRestart(server, "relaunch", vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED")))).toBe("connect ECONNREFUSED");
    expect(await armRestart(server, "relaunch", vi.fn().mockRejectedValue({ toString: () => "offline" }))).toBe("offline");
  });
});

describe("restartFor", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const make = (installNow: boolean) => ({ updater: { installNow: vi.fn(() => installNow) }, app: { relaunch: vi.fn(), quit: vi.fn() } });

  it("answers ok at once and acts only after the delay", () => {
    const { updater, app } = make(false);
    expect(restartFor({ then: "relaunch", updater, app })).toEqual({ ok: true });
    vi.advanceTimersByTime(99);
    expect(app.relaunch).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(app.relaunch).toHaveBeenCalledTimes(1);
    expect(app.quit).toHaveBeenCalledTimes(1);
  });

  it("relaunches without asking the updater for a plain relaunch", () => {
    const { updater, app } = make(true);
    restartFor({ then: "relaunch", updater, app, delay: 10 });
    vi.advanceTimersByTime(10);
    expect(updater.installNow).not.toHaveBeenCalled();
    expect(app.relaunch).toHaveBeenCalled();
    expect(app.quit).toHaveBeenCalled();
  });

  it("installs the downloaded update and doesn't relaunch when one is ready", () => {
    const { updater, app } = make(true);
    restartFor({ then: "update", updater, app, delay: 10 });
    vi.advanceTimersByTime(10);
    expect(updater.installNow).toHaveBeenCalledTimes(1);
    expect(app.relaunch).not.toHaveBeenCalled();
    expect(app.quit).not.toHaveBeenCalled();
  });

  it("relaunches and quits when update was armed but none is ready", () => {
    const { updater, app } = make(false);
    restartFor({ then: "update", updater, app, delay: 10 });
    vi.advanceTimersByTime(10);
    expect(updater.installNow).toHaveBeenCalledTimes(1);
    expect(app.relaunch).toHaveBeenCalledTimes(1);
    expect(app.quit).toHaveBeenCalledTimes(1);
  });
});
