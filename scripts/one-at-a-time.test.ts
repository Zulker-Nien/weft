import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { lockPath, tryLock, unlock, waitForLock } from "./one-at-a-time.mjs";

let dir: string;
let file: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "one-at-a-time-"));
  file = lockPath("typecheck", dir);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

// A pid no process has: a finished child's.
function deadPid() {
  return Number(execFileSync("sh", ["-c", "echo $$"], { encoding: "utf8" }));
}

describe("lockPath", () => {
  it("names the lock after the check, safe for a file name", () => {
    expect(lockPath("lint", "/t")).toBe("/t/weft-lint.lock");
    expect(lockPath("a/b c", "/t")).toBe("/t/weft-a_b_c.lock");
  });
});

describe("tryLock and unlock", () => {
  it("takes a free lock, refuses a held one, and frees it for its holder only", () => {
    expect(tryLock(file, process.pid)).toBe(true);
    expect(tryLock(file, process.pid + 1)).toBe(false);
    unlock(file, process.pid + 1);
    expect(fs.existsSync(file)).toBe(true);
    unlock(file, process.pid);
    expect(fs.existsSync(file)).toBe(false);
  });

  it("takes over a lock whose holder has exited", () => {
    fs.writeFileSync(file, String(deadPid()));
    expect(tryLock(file, process.pid)).toBe(true);
    expect(fs.readFileSync(file, "utf8")).toBe(String(process.pid));
  });

  it("unlock is quiet when the lock is already gone", () => {
    expect(() => unlock(file)).not.toThrow();
  });
});

describe("waitForLock", () => {
  it("waits while another process holds it, telling once, then takes it when freed", async () => {
    fs.writeFileSync(file, String(process.ppid));
    const waits: number[] = [];
    const waiting = waitForLock(file, { poll: 5, onWait: (pid: number) => waits.push(pid) });
    await new Promise((resolve) => setTimeout(resolve, 30));
    fs.rmSync(file);
    await waiting;
    expect(waits).toEqual([process.ppid]);
    expect(fs.readFileSync(file, "utf8")).toBe(String(process.pid));
  });
});

describe("the command line", () => {
  const script = path.join(__dirname, "one-at-a-time.mjs");

  it("runs the command with its args and passes its exit code through", () => {
    const run = (cmd: string) => {
      try {
        return execFileSync(process.execPath, [script, `test-${process.pid}`, cmd, "x"], { encoding: "utf8" });
      } catch (err) {
        return (err as { status: number }).status;
      }
    };
    expect(run("echo hi")).toBe("hi x\n");
    expect(run("exit 3 ;")).toBe(3);
  });

  it("explains its usage without a command", () => {
    expect(() => execFileSync(process.execPath, [script, "lint"], { stdio: "pipe" })).toThrow();
  });
});
