import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { guardOrphan, WATCH_MS } from "./orphan-guard";

function fakeWorker(over: { connected?: boolean } = { connected: true }) {
  const emitter = new EventEmitter();
  return Object.assign(emitter, { pid: 4242, ppid: 100, kill: vi.fn() }, over);
}

describe("guardOrphan", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("does nothing in a process with no IPC channel (threads pool, plain node)", () => {
    const proc = fakeWorker({});
    expect(guardOrphan(proc)).toBe(false);
    proc.emit("disconnect");
    expect(proc.kill).not.toHaveBeenCalled();
  });

  it("watches once per process", () => {
    const proc = fakeWorker();
    expect(guardOrphan(proc)).toBe(true);
    expect(guardOrphan(proc)).toBe(false);
  });

  it("kills itself when the channel to its parent closes", () => {
    const proc = fakeWorker();
    guardOrphan(proc);
    proc.emit("disconnect");
    expect(proc.kill).toHaveBeenCalledWith(4242, "SIGKILL");
  });

  it("kills itself once it's reparented", () => {
    const proc = fakeWorker();
    guardOrphan(proc);
    vi.advanceTimersByTime(WATCH_MS);
    expect(proc.kill).not.toHaveBeenCalled();
    proc.ppid = 1;
    vi.advanceTimersByTime(WATCH_MS);
    expect(proc.kill).toHaveBeenCalledWith(4242, "SIGKILL");
  });

  it("kills itself when the channel is down even if no disconnect fired", () => {
    const proc = fakeWorker();
    guardOrphan(proc, 50);
    proc.connected = false;
    vi.advanceTimersByTime(50);
    expect(proc.kill).toHaveBeenCalledOnce();
  });

  it("defaults to the real process", () => {
    // The setup file already guards this worker, so a second call is a no-op.
    expect(guardOrphan()).toBe(false);
  });
});
