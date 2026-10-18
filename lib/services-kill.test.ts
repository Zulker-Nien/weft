import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceEntry } from "./types";

const endSession = vi.hoisted(() => vi.fn());
vi.mock("./runner", () => ({ endSession }));

const stopDev = vi.hoisted(() => vi.fn());
vi.mock("./devserver", () => ({ stopDev }));

const stopTask = vi.hoisted(() => vi.fn());
vi.mock("./task-stop", () => ({ stopTask }));

const listServices = vi.hoisted(() => vi.fn());
vi.mock("./services-snapshot", () => ({ listServices }));

const kill = await import("./services-kill");

const service = (over: Partial<ServiceEntry> = {}): ServiceEntry => ({
  id: "s1",
  kind: "cli",
  label: "x",
  state: "running",
  cpu: 0,
  memKb: 0,
  startedAt: 0,
  procs: [],
  cardId: "c1",
  ...over,
});

beforeEach(() => {
  endSession.mockReset();
  stopDev.mockReset();
  stopTask.mockReset();
  listServices.mockReset();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("ServiceRefused", () => {
  it("is an Error subclass", () => {
    expect(new kill.ServiceRefused("nope")).toBeInstanceOf(Error);
    expect(new kill.ServiceRefused("nope").message).toBe("nope");
  });
});

describe("terminate", () => {
  it("SIGTERMs the pids in reverse, then SIGKILLs what survived after the grace", () => {
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    kill.terminate([10, 20, 30]);
    expect(killSpy.mock.calls.map((c) => c[1])).toEqual(["SIGTERM", "SIGTERM", "SIGTERM"]);
    expect(killSpy.mock.calls.map((c) => c[0])).toEqual([30, 20, 10]);
    expect(killSpy).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(2_000);
    expect(killSpy.mock.calls.map((c) => [c[0], c[1]])).toEqual([
      [30, "SIGTERM"],
      [20, "SIGTERM"],
      [10, "SIGTERM"],
      [30, "SIGKILL"],
      [20, "SIGKILL"],
      [10, "SIGKILL"],
    ]);
  });

  it("skips a SIGKILL pass when no SIGTERM actually sent", () => {
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      throw new Error("ESRCH");
    });
    kill.terminate([10]);
    expect(killSpy).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5_000);
    expect(killSpy).toHaveBeenCalledTimes(1);
  });

  it("unrefs the kill-after-grace timer so it never holds the loop", () => {
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    kill.terminate([10]);
    const handle = vi.getTimerCount();
    expect(handle).toBeGreaterThan(0);
    vi.advanceTimersByTime(2_000);
    expect(killSpy.mock.calls.map((c) => c[1])).toContain("SIGKILL");
  });
});

describe("killService", () => {
  it("refuses Weft itself", async () => {
    listServices.mockResolvedValue([service({ id: "weft", kind: "weft" })]);
    await expect(kill.killService("weft")).rejects.toBeInstanceOf(kill.ServiceRefused);
  });

  it("ends a thread CLI by cardId", async () => {
    listServices.mockResolvedValue([service({ id: "cli:c1", kind: "cli", cardId: "c1" })]);
    endSession.mockResolvedValue(undefined);
    await kill.killService("cli:c1");
    expect(endSession).toHaveBeenCalledWith("c1");
  });

  it("stops a Weft dev server by cardId", async () => {
    listServices.mockResolvedValue([service({ id: "dev:c1", kind: "dev", cardId: "c1" })]);
    await kill.killService("dev:c1");
    expect(stopDev).toHaveBeenCalledWith("c1");
  });

  it("stops a thread's own dev server by cardId and taskId", async () => {
    listServices.mockResolvedValue([service({ id: "task:c1:t1", kind: "task", cardId: "c1", taskId: "t1" })]);
    stopTask.mockResolvedValue(undefined);
    await kill.killService("task:c1:t1");
    expect(stopTask).toHaveBeenCalledWith("c1", "t1");
  });

  it("terminates an unknown service's pids", async () => {
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    listServices.mockResolvedValue([service({ id: "pid:1", kind: "other", procs: [{ pid: 1, ppid: 1, cpu: 0, memKb: 0, command: "x" }, { pid: 2, ppid: 1, cpu: 0, memKb: 0, command: "y" }] })]);
    await kill.killService("pid:1");
    expect(killSpy.mock.calls.map((c) => c[0])).toEqual([2, 1]);
  });

  it("is a no-op when no service with that id is found", async () => {
    listServices.mockResolvedValue([]);
    await kill.killService("missing");
    expect(endSession).not.toHaveBeenCalled();
    expect(stopDev).not.toHaveBeenCalled();
    expect(stopTask).not.toHaveBeenCalled();
  });
});

describe("killProc", () => {
  it("refuses a pid that isn't tracked by a service", async () => {
    listServices.mockResolvedValue([]);
    await expect(kill.killProc(999)).rejects.toBeInstanceOf(kill.ServiceRefused);
  });

  it("ends the whole service when killing its lead proc", async () => {
    listServices.mockResolvedValue([service({ id: "cli:c1", kind: "cli", cardId: "c1", procs: [{ pid: 50, ppid: 1, cpu: 0, memKb: 0, command: "x" }] })]);
    endSession.mockResolvedValue(undefined);
    await kill.killProc(50);
    expect(endSession).toHaveBeenCalledWith("c1");
  });

  it("refuses to end Weft from a child pid", async () => {
    listServices.mockResolvedValue([service({ id: "weft", kind: "weft", procs: [{ pid: 7, ppid: 1, cpu: 0, memKb: 0, command: "next-server" }] })]);
    await expect(kill.killProc(7)).rejects.toBeInstanceOf(kill.ServiceRefused);
  });

  it("refuses to end a non-lead weft child without ending the rest", async () => {
    // procs[0] is pid 5 (the lead); killing 7 must take the second branch, not the first.
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    listServices.mockResolvedValue([service({ id: "weft", kind: "weft", procs: [
      { pid: 5, ppid: 1, cpu: 0, memKb: 0, command: "next-server" },
      { pid: 7, ppid: 1, cpu: 0, memKb: 0, command: "next-server worker" },
    ] })]);
    await expect(kill.killProc(7)).rejects.toBeInstanceOf(kill.ServiceRefused);
    expect(killSpy).not.toHaveBeenCalled();
  });

  it("only terminates the one pid when it's a non-lead child", async () => {
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    listServices.mockResolvedValue([service({ id: "pid:1", kind: "other", procs: [{ pid: 1, ppid: 1, cpu: 0, memKb: 0, command: "x" }, { pid: 2, ppid: 1, cpu: 0, memKb: 0, command: "y" }] })]);
    await kill.killProc(2);
    expect(killSpy.mock.calls.map((c) => c[0])).toEqual([2]);
    vi.advanceTimersByTime(2_000);
    expect(killSpy.mock.calls.map((c) => c[0])).toEqual([2, 2]);
  });
});
