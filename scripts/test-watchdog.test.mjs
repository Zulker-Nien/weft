// Tests for the whole-suite RSS watchdog (scripts/test-watchdog.mjs). The parsing and the argument split are
// pure and cheap; the one live test spawns a real process tree, allocates past a tiny limit and checks the
// watcher ends it. Nothing here runs the test suite.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_RSS_MB, parseArgv, parseRssKb, runWatched, startWatchdog, treePids, treeRssMb } from "./test-watchdog.mjs";

describe("parseRssKb", () => {
  it("reads the KiB value ps prints", () => {
    expect(parseRssKb(" 123456\n")).toBe(123456);
  });
  it("is 0 for a pid that is gone, or output it can't read", () => {
    expect(parseRssKb("")).toBe(0);
    expect(parseRssKb("")).toBe(0);
  });
});

describe("parseArgv", () => {
  it("splits on -- so the command keeps its own flags", () => {
    const parsed = parseArgv(["--limit-mb", "512", "--", "pnpm", "test", "--coverage"]);
    expect(parsed.limitMb).toBe(512);
    expect(parsed.command).toEqual(["pnpm", "test", "--coverage"]);
  });
  it("defaults the ceiling when no --limit-mb is given", () => {
    expect(parseArgv(["--", "pnpm", "test"]).limitMb).toBe(DEFAULT_MAX_RSS_MB);
  });
  it("falls back to the default on a junk limit rather than running unwatched", () => {
    expect(parseArgv(["--limit-mb", "lots", "--", "pnpm", "test"]).limitMb).toBe(DEFAULT_MAX_RSS_MB);
  });
  it("reports no command when there is no --", () => {
    expect(parseArgv(["--limit-mb", "512"]).command).toEqual([]);
  });
});

describe("the process tree", () => {
  it("finds a grandchild, and folds in the root itself", async () => {
    // `sh -c 'sleep 30'` would exec the sleep in place of the shell, leaving nothing to find. Wrapping it in
    // an outer sh keeps two generations alive: outer sh -> inner sh -> sleep. detached puts the whole thing in
    // one process group so the cleanup kills every generation, not just the outer sh.
    const child = execFile("/bin/sh", ["-c", "/bin/sh -c 'sleep 30' & wait"], { detached: true });
    try {
      await new Promise((resolve) => setTimeout(resolve, 250));
      const pids = await treePids(child.pid);
      expect(pids).toContain(child.pid);
      expect(pids.length).toBeGreaterThan(1);
    } finally {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }
  });

  it("counts a running process's own RSS in MiB", async () => {
    const child = execFile("/bin/sh", ["-c", "sleep 5"]);
    try {
      await new Promise((resolve) => setTimeout(resolve, 250));
      const { mb, processes } = await treeRssMb(child.pid);
      expect(processes).toBeGreaterThanOrEqual(1);
      // A sleeping shell is a few MB; anything under 1 would mean the parse broke, not that it shrank.
      expect(mb).toBeGreaterThanOrEqual(1);
    } finally {
      child.kill("SIGKILL");
    }
  });
});

describe("startWatchdog", () => {
  it("ends a run that outgrows the ceiling, and says why", async () => {
    // Allocate in the child past a 40 MB ceiling: Node's RSS climbs well past that in a second or two. The buffers
    // are filled, since macOS maps zero-filled ones lazily and they never count as resident.
    const lines = [];
    const child = execFile(
      process.execPath,
      ["-e", "const b = []; for (let i = 0; i < 400; i++) b.push(Buffer.alloc(1024 * 1024, 1)); setInterval(() => {}, 1000);"],
    );
    const originalError = console.error;
    console.error = (...args) => lines.push(args.join(" "));
    const stop = startWatchdog(child, 40);
    try {
      const code = await new Promise((resolve) => child.on("exit", resolve));
      expect(code).not.toBe(0);
      expect(lines.join("\n")).toContain("passed 40 MB of resident memory");
    } finally {
      stop?.();
      console.error = originalError;
      if (child.exitCode === null) child.kill("SIGKILL");
    }
  }, 20_000);

  it("leaves a run that stays under the ceiling alone", async () => {
    const child = execFile("/bin/sh", ["-c", "sleep 1"]);
    const stop = startWatchdog(child, 3072);
    const code = await new Promise((resolve) => child.on("exit", resolve));
    stop?.();
    expect(code).toBe(0);
  }, 20_000);
});

describe("runWatched", () => {
  it("passes through a quick command's exit code", async () => {
    expect(await runWatched({ limitMb: 3072, command: ["/bin/sh", "-c", "exit 0"] })).toBe(0);
    expect(await runWatched({ limitMb: 3072, command: ["/bin/sh", "-c", "exit 3"] })).toBe(3);
  });
});