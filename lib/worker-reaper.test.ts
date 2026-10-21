import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

const execFile = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execFile }));

import {
  etimeSeconds,
  isNextDev,
  isVitestWorker,
  MIN_AGE_S,
  parsePsAged,
  reapOrphanWorkers,
  REAP_EVERY_MS,
  startWorkerReaper,
  stopWorkerReaper,
} from "./worker-reaper";

// Routes ps and lsof; promisify(execFile) calls the mock as (file, args, cb).
function fakeExec(ps: string, lsof = "") {
  execFile.mockImplementation((file: string, _args: string[], cb: (e: unknown, r?: unknown) => void) => {
    if (file === "/bin/ps") cb(null, { stdout: ps, stderr: "" });
    else cb(null, { stdout: lsof, stderr: "" });
  });
}

describe("isVitestWorker", () => {
  it("matches pool workers, not the run itself or other node", () => {
    expect(isVitestWorker("node (vitest 3)     ")).toBe(true);
    expect(isVitestWorker("node (vitest 12)")).toBe(true);
    expect(isVitestWorker("node (vitest)")).toBe(false);
    expect(isVitestWorker("node server.js")).toBe(false);
  });
});

describe("isNextDev", () => {
  it("matches both halves of a next dev: the launcher and the worker it forks", () => {
    // Real command lines from this box (2026-10-22).
    expect(isNextDev("node /Users/me/dev/weft/node_modules/next/dist/bin/next dev -H 127.0.0.1 -p 1024")).toBe(true);
    expect(isNextDev("next-server (v16.4.0)")).toBe(true);
    expect(isNextDev("node /x/node_modules/.pnpm/next@16.3.8/node_modules/next/dist/bin/next dev -p 8080")).toBe(true);
  });
  it("rejects other next commands and look-alikes", () => {
    expect(isNextDev("next build")).toBe(false);
    expect(isNextDev("next start")).toBe(false);
    expect(isNextDev("node server.js")).toBe(false);
    expect(isNextDev("node /x/nextcrawler")).toBe(false);
    expect(isNextDev("next dev-runner")).toBe(false);
  });
});

describe("etimeSeconds", () => {
  it("reads mm:ss, hh:mm:ss and dd-hh:mm:ss", () => {
    expect(etimeSeconds("00:07")).toBe(7);
    expect(etimeSeconds("56:01")).toBe(3361);
    expect(etimeSeconds("01:00:00")).toBe(3600);
    expect(etimeSeconds("2-00:00:01")).toBe(172_801);
    expect(etimeSeconds("5")).toBe(5);
  });
});

describe("parsePsAged", () => {
  it("parses rows with their age and skips garbage", () => {
    expect(parsePsAged(" 10     1   24:00 node (vitest 1)\n\nnope\n 11 10 00:03 node (vitest)\n")).toEqual([
      { pid: 10, ppid: 1, age: 1440, command: "node (vitest 1)" },
      { pid: 11, ppid: 10, age: 3, command: "node (vitest)" },
    ]);
  });
});

describe("reapOrphanWorkers", () => {
  let kill: MockInstance<typeof process.kill>;
  let log: MockInstance<typeof console.log>;

  beforeEach(() => {
    execFile.mockReset();
    kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    log = vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("returns early on win32", async () => {
    const real = Object.getOwnPropertyDescriptor(process, "platform")!;
    Object.defineProperty(process, "platform", { value: "win32" });
    try {
      expect(await reapOrphanWorkers(["/a/weft"])).toEqual([]);
    } finally {
      Object.defineProperty(process, "platform", real);
    }
    expect(execFile).not.toHaveBeenCalled();
  });

  it("returns early with no folders", async () => {
    expect(await reapOrphanWorkers([])).toEqual([]);
    expect(execFile).not.toHaveBeenCalled();
  });

  it("leaves workers with a live parent, young orphans and the run itself alone", async () => {
    fakeExec("10 7 30:00 node (vitest 1)\n11 1 00:30 node (vitest 2)\n12 1 30:00 node (vitest)\n");
    expect(await reapOrphanWorkers(["/a/weft"])).toEqual([]);
    expect(execFile).toHaveBeenCalledTimes(1);
    expect(kill).not.toHaveBeenCalled();
  });

  it("kills old orphaned workers inside a Weft folder only", async () => {
    fakeExec("10 1 30:00 node (vitest 1)\n13 1 1:00:00 node (vitest 4)\n", "p10\nn/a/weft\np13\nn/elsewhere\n");
    expect(await reapOrphanWorkers(["/a/weft"])).toEqual([10]);
    expect(kill).toHaveBeenCalledExactlyOnceWith(10, "SIGKILL");
    expect(log).toHaveBeenCalledWith(expect.stringContaining("ended 1 orphaned worker(s) or dev server(s)"));
  });

  // The leak behind the six heap OOMs of 2026-10-16..18: when a next dev launcher dies, its
  // next-server worker reparents to PID 1 and keeps ~1.9 GB. Both halves must go.
  it("kills an orphaned next dev server (the worker whose launcher died) inside a Weft folder", async () => {
    fakeExec(
      "20 1 1:00:00 next-server (v16.4.0)\n21 99 1:00:00 next-server (v16.4.0)\n",
      "p20\nn/a/weft\np21\nn/a/weft\n",
    );
    expect(await reapOrphanWorkers(["/a/weft"])).toEqual([20]);
    expect(kill).toHaveBeenCalledExactlyOnceWith(20, "SIGKILL");
  });

  it("kills an orphaned next dev launcher too, and leaves another project's dev server alone", async () => {
    fakeExec(
      "30 1 1:00:00 node /a/weft/node_modules/next/dist/bin/next dev -H 127.0.0.1 -p 1024\n" +
        "31 1 12:12:50 next-server (v16.3.8)\n",
      "p30\nn/a/weft\np31\nn/other/groovenfill\n",
    );
    expect(await reapOrphanWorkers(["/a/weft"])).toEqual([30]);
  });

  it("leaves a next dev that still has its parent, and one too young, alone", async () => {
    // 30:00 is well past MIN_AGE_S, so only the live parent spares pid 40; 41 is young.
    fakeExec(
      "40 7 30:00 next-server (v16.4.0)\n41 1 00:30 next-server (v16.4.0)\n",
      "p40\nn/a/weft\np41\nn/a/weft\n",
    );
    expect(await reapOrphanWorkers(["/a/weft"])).toEqual([]);
    expect(kill).not.toHaveBeenCalled();
  });

  it("says nothing when every orphan is outside Weft's folders", async () => {
    fakeExec(`10 1 ${MIN_AGE_S / 60}:00 node (vitest 1)\n`, "p10\nn/elsewhere\n");
    expect(await reapOrphanWorkers(["/a/weft"])).toEqual([]);
    expect(log).not.toHaveBeenCalled();
  });
});

describe("startWorkerReaper", () => {
  let err: MockInstance<typeof console.error>;

  beforeEach(() => {
    vi.useFakeTimers();
    execFile.mockReset();
    err = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    stopWorkerReaper();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("reaps now and then every interval, once per server", () => {
    fakeExec("");
    const folders = vi.fn(() => ["/a/weft"]);
    expect(startWorkerReaper(folders)).toBe(true);
    expect(startWorkerReaper(folders)).toBe(false);
    expect(folders).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(REAP_EVERY_MS);
    expect(folders).toHaveBeenCalledTimes(2);
  });

  it("logs a failed check instead of throwing", async () => {
    execFile.mockImplementation((_f: string, _a: string[], cb: (e: unknown) => void) => cb(new Error("ps gone")));
    startWorkerReaper(() => ["/a/weft"]);
    await vi.waitFor(() => expect(err).toHaveBeenCalledWith("[weft] orphaned worker check failed:", expect.any(Error)));
  });
});
