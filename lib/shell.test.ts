import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Card, ThreadItem } from "./types";

const h = vi.hoisted(() => ({ cards: new Map<string, Card>(), thread: [] as (ThreadItem | null)[] }));
vi.mock("./store", () => ({
  DATA_DIR: "/tmp/weft-shell-test-data",
  getCard: (id: string) => h.cards.get(id),
  getThread: () => h.thread,
  appendThread: (_id: string, item: ThreadItem) => h.thread.push(item) - 1,
  replaceThreadItem: (_id: string, index: number, item: ThreadItem) => {
    h.thread[index] = item;
  },
}));
vi.mock("./env", () => ({ cliEnv: () => ({ ...process.env }) }));
const { cleanOutput, OUTPUT_LIMIT, redactSecrets, runShell, shellBlock, SHELL_TIMEOUT_MS, takeShellContext, withShellContext } = await import("./shell");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-shell-"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

type Shell = Extract<ThreadItem, { kind: "shell" }>;
const shellAt = (i: number) => h.thread[i] as Shell;
// Resolves once the item at index has its output.
async function ended(index: number) {
  await vi.waitFor(() => expect(shellAt(index).ms).toBeDefined(), { timeout: 5000 });
  return shellAt(index);
}

beforeEach(() => {
  h.cards.clear();
  h.cards.set("c1", { id: "c1", cwd: dir } as Card);
  h.thread = [];
});

describe("runShell", () => {
  it("runs the command in the card's folder and fills in its output and exit code", async () => {
    const index = runShell("c1", "pwd; echo oops >&2");
    expect(shellAt(index)).toMatchObject({ kind: "shell", command: "pwd; echo oops >&2" });
    const item = await ended(index);
    expect(item.output).toContain(fs.realpathSync(dir));
    expect(item.output).toContain("oops");
    expect(item.exitCode).toBe(0);
  });

  // Weft is macOS-only, where /bin/zsh always exists; CI's Ubuntu runner has no zsh.
  it.skipIf(!fs.existsSync("/bin/zsh"))("reports a failing command's exit code, in zsh when $SHELL isn't set", async () => {
    const shell = process.env.SHELL;
    delete process.env.SHELL;
    try {
      const item = await ended(runShell("c1", "exit 3"));
      expect(item.exitCode).toBe(3);
    } finally {
      process.env.SHELL = shell;
    }
  });

  it("refuses a command whose output would put a secret in front of Claude", () => {
    expect(() => runShell("c1", "cat .env")).toThrow("Not run, since its output goes to Claude");
    expect(h.thread).toEqual([]);
  });

  it("refuses an empty command, a missing card and a folder that's gone", () => {
    expect(() => runShell("c1", "")).toThrow("Write a command");
    expect(() => runShell("nope", "ls")).toThrow("No such card");
    h.cards.set("c2", { id: "c2", cwd: path.join(dir, "gone") } as Card);
    expect(() => runShell("c2", "ls")).toThrow("doesn't exist anymore");
  });

  it("kills a command that runs past the timeout", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const index = runShell("c1", "sleep 30");
      vi.advanceTimersByTime(SHELL_TIMEOUT_MS);
      vi.useRealTimers();
      const item = await ended(index);
      expect(item.timedOut).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("kills the command itself when its process group is already gone", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const kill = vi.spyOn(process, "kill").mockImplementationOnce(() => {
      throw new Error("ESRCH");
    });
    try {
      const index = runShell("c1", "sleep 30");
      vi.advanceTimersByTime(SHELL_TIMEOUT_MS);
      vi.useRealTimers();
      expect((await ended(index)).timedOut).toBe(true);
    } finally {
      kill.mockRestore();
      vi.useRealTimers();
    }
  });

  it("shows why a shell that can't start didn't run", async () => {
    const shell = process.env.SHELL;
    process.env.SHELL = path.join(dir, "no-such-shell");
    try {
      const item = await ended(runShell("c1", "ls"));
      expect(item.exitCode).toBeNull();
      expect(item.output).toContain("ENOENT");
    } finally {
      process.env.SHELL = shell;
    }
  });
});

describe("cleanOutput", () => {
  it("drops colors and carriage returns", () => {
    expect(cleanOutput("\u001b[31mred\u001b[0m\r\nnext\n\n")).toBe("red\nnext");
  });

  it("keeps the end of long output and says how much was cut", () => {
    const out = cleanOutput("a".repeat(OUTPUT_LIMIT + 10) + "END");
    expect(out.startsWith("… (13 characters cut)\n")).toBe(true);
    expect(out.endsWith("END")).toBe(true);
  });
});

describe("redactSecrets", () => {
  it("swaps each key it finds for what it was", () => {
    const key = `ghp_${"a".repeat(36)}`;
    expect(redactSecrets(`token ${key} and ${key}`)).toBe("token ‹a GitHub token› and ‹a GitHub token›");
    expect(redactSecrets("nothing here")).toBe("nothing here");
  });
});

describe("shell context", () => {
  const done = (command: string, more: Partial<Shell> = {}): Shell => ({ kind: "shell", command, at: 1, output: "out", exitCode: 0, ms: 5, ...more });

  it("writes a command the way Claude Code hands bash mode to Claude", () => {
    expect(shellBlock(done("ls"))).toBe("<bash-input>ls</bash-input>\n<bash-stdout>out</bash-stdout>");
    expect(shellBlock(done("false", { exitCode: 1 }))).toContain("out\n(exit code 1)</bash-stdout>");
    expect(shellBlock(done("sleep 999", { timedOut: true, exitCode: null }))).toContain("(stopped after 2 minutes)");
    expect(shellBlock({ kind: "shell", command: "x", at: 1, ms: 1 })).toContain("<bash-stdout></bash-stdout>");
  });

  it("takes each finished, unsent command once and marks it sent", () => {
    h.thread = [null, done("a"), { kind: "user", text: "hi", at: 2 }, done("b", { sent: true }), { kind: "shell", command: "running", at: 3 }];
    expect(takeShellContext("c1")).toBe(shellBlock(done("a")));
    expect(shellAt(1).sent).toBe(true);
    expect(shellAt(4).sent).toBeUndefined();
    expect(takeShellContext("c1")).toBe("");
  });

  it("puts the context before the message, and waits on a slash command", () => {
    h.thread = [done("a")];
    expect(withShellContext("c1", "/weft:done")).toBe("/weft:done");
    expect(withShellContext("c1", "why did it fail?")).toBe(`${shellBlock(done("a"))}\n\nwhy did it fail?`);
    expect(withShellContext("c1", "again")).toBe("again");
  });
});
