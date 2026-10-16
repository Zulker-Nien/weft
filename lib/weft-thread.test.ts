import { describe, expect, it } from "vitest";
import { hookIsWeftThread, isWeftThread, parseProcs } from "./weft-thread";

const SERVER = 100;

// Lines of `ps -A -o pid=,ppid=,comm=`: pid, parent, command.
const table = (rows: [number, number, string][]) => parseProcs(rows.map(([pid, ppid, comm]) => `  ${pid}   ${ppid} ${comm}`).join("\n"));

describe("parseProcs", () => {
  it("reads pid, parent and the command's base name, skipping junk", () => {
    const procs = parseProcs("  1 0 /sbin/launchd\n  42 1 /Applications/My App.app/Contents/MacOS/My App\nnot a row\n");
    expect(procs.get(1)).toEqual({ ppid: 0, comm: "launchd" });
    expect(procs.get(42)).toEqual({ ppid: 1, comm: "My App" });
    expect(procs.size).toBe(2);
  });
});

describe("isWeftThread", () => {
  it("is true for a hook of Weft's claude CLI, with or without a hook shell", () => {
    expect(isWeftThread(3, SERVER, table([[200, SERVER, "claude"], [3, 200, "node"]]))).toBe(true);
    expect(isWeftThread(3, SERVER, table([[200, SERVER, "claude"], [201, 200, "sh"], [3, 201, "node"]]))).toBe(true);
  });

  it("is true for Weft's puku-cli, a node wrapper around Puku", () => {
    expect(isWeftThread(3, SERVER, table([[200, SERVER, "node"], [201, 200, "Puku"], [202, 201, "sh"], [3, 202, "node"]]))).toBe(true);
  });

  it("is false for a CLI a thread started from its Bash, the server too far up, or no server", () => {
    const fromBash = table([
      [200, SERVER, "claude"],
      [201, 200, "zsh"],
      [202, 201, "puku-cli"],
      [3, 202, "node"],
    ]);
    expect(isWeftThread(3, SERVER, fromBash)).toBe(false);
    const deep = table([[200, SERVER, "a"], [201, 200, "b"], [202, 201, "c"], [203, 202, "d"], [3, 203, "node"]]);
    expect(isWeftThread(3, SERVER, deep)).toBe(false);
    expect(isWeftThread(3, SERVER, table([[3, 77, "node"]]))).toBe(false);
    expect(isWeftThread(3, SERVER, table([]))).toBe(false);
  });
});

describe("hookIsWeftThread", () => {
  it("is false without WEFT_SERVER_PID, and for a process the server didn't start", () => {
    expect(hookIsWeftThread({})).toBe(false);
    expect(hookIsWeftThread({ WEFT_SERVER_PID: "1" }, process.pid)).toBe(false);
  });

  it("is true when the given server is the hook's parent", () => {
    expect(hookIsWeftThread({ WEFT_SERVER_PID: String(process.ppid) }, process.pid)).toBe(true);
  });

  it("is false when ps fails", () => {
    const failing = () => {
      throw new Error("no ps");
    };
    expect(hookIsWeftThread({ WEFT_SERVER_PID: "1" }, 3, failing)).toBe(false);
  });
});
