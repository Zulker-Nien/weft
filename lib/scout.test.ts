import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({ messages: [] as unknown[], calls: [] as unknown[], fail: null as Error | null }));

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: (args: unknown) => {
    sdk.calls.push(args);
    return (async function* () {
      await Promise.resolve();
      if (sdk.fail) throw sdk.fail;
      yield* sdk.messages;
    })();
  },
}));

process.env.THREADBOARD_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "weft-scout-"));
const { headCommit, markStarted, readScout, scoutFile, scoutPrompt, scoutState, startScout } = await import("./scout");

const finding = { file: "lib/a.ts", line: 3, smell: "Long Function", category: "refactor", severity: "high", fix: "Split it" };
const ok = (list: unknown[]) => [{ type: "assistant" }, { type: "result", subtype: "success", result: JSON.stringify(list) }];

function repo() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "weft-scout-repo-")));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "ignore" });
  git("init", "-q");
  fs.writeFileSync(path.join(dir, "a.ts"), "export {}\n");
  git("add", ".");
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");
  return { dir, commit: () => git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "next") };
}

const plain = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "weft-scout-plain-")));

beforeEach(() => {
  sdk.messages = [];
  sdk.calls = [];
  sdk.fail = null;
});

describe("headCommit", () => {
  it("reads HEAD, or null outside git", () => {
    expect(headCommit(repo().dir)).toMatch(/^[0-9a-f]{40}$/);
    expect(headCommit(plain())).toBeNull();
  });
});

describe("startScout", () => {
  it("runs a read-only Sonnet in the project and caches its findings with the commit", async () => {
    const { dir } = repo();
    sdk.messages = ok([finding]);
    await startScout(dir);
    expect(sdk.calls).toEqual([
      {
        prompt: scoutPrompt(),
        options: expect.objectContaining({ model: "sonnet", cwd: dir, tools: ["Read", "Grep", "Glob"], settingSources: [], persistSession: false }) as unknown,
      },
    ]);
    const report = readScout(dir);
    expect(report).toMatchObject({ root: dir, commit: headCommit(dir), started: [] });
    expect(report?.findings.map((f) => f.id)).toEqual(["lib/a.ts:3:Long Function"]);
    expect(fs.existsSync(scoutFile(dir))).toBe(true);
  });

  it("runs once per project at a time", async () => {
    const { dir } = repo();
    sdk.messages = ok([finding]);
    const a = startScout(dir);
    const b = startScout(dir);
    expect(a).toBe(b);
    await a;
    expect(sdk.calls).toHaveLength(1);
  });

  it("keeps started marks only for findings it still sees", async () => {
    const { dir } = repo();
    sdk.messages = ok([finding, { ...finding, line: 9 }]);
    await startScout(dir);
    markStarted(dir, "lib/a.ts:3:Long Function");
    markStarted(dir, "lib/a.ts:9:Long Function");
    sdk.messages = ok([finding]);
    await startScout(dir);
    expect(readScout(dir)?.started).toEqual(["lib/a.ts:3:Long Function"]);
  });

  it("reports a failed, empty or thrown run as an error and keeps the old report", async () => {
    const dir = plain();
    sdk.messages = [{ type: "result", subtype: "error_max_turns" }];
    await startScout(dir);
    expect(scoutState(dir)).toEqual({ report: null, running: false, error: "The scout stopped: error_max_turns" });

    sdk.messages = [{ type: "result", subtype: "success", result: "nothing to see" }];
    await startScout(dir);
    expect(scoutState(dir).error).toBe("The scout returned no findings");

    sdk.fail = new Error("boom");
    await startScout(dir);
    expect(scoutState(dir).error).toBe("boom");
    expect(readScout(dir)).toBeNull();
  });

  it("names a non-Error throw", async () => {
    const dir = plain();
    sdk.fail = "plain" as unknown as Error;
    await startScout(dir);
    expect(scoutState(dir).error).toBe("plain");
  });
});

describe("scoutState", () => {
  it("starts a run when there's no report, and says it's running", async () => {
    const { dir } = repo();
    sdk.messages = ok([finding]);
    const state = scoutState(path.join(dir));
    expect(state).toEqual({ report: null, running: true });
    await startScout(dir);
    expect(scoutState(dir)).toMatchObject({ running: false, report: { commit: headCommit(dir) } });
    expect(sdk.calls).toHaveLength(1);
  });

  it("never re-runs because HEAD moved, however old the report; only when forced", async () => {
    const { dir, commit } = repo();
    sdk.messages = ok([finding]);
    await startScout(dir);
    commit();
    const old = readScout(dir)!;
    fs.writeFileSync(scoutFile(dir), JSON.stringify({ ...old, ranAt: 0 }));
    expect(scoutState(dir).running).toBe(false);
    expect(sdk.calls).toHaveLength(1);

    scoutState(dir, { force: true });
    await startScout(dir);
    expect(sdk.calls).toHaveLength(2);
  });

  it("doesn't retry on its own after a failure until forced", async () => {
    const dir = plain();
    sdk.fail = new Error("down");
    await startScout(dir);
    scoutState(dir);
    expect(sdk.calls).toHaveLength(1);
    sdk.fail = null;
    sdk.messages = ok([finding]);
    scoutState(dir, { force: true });
    await startScout(dir);
    expect(scoutState(dir).error).toBeUndefined();
  });
});

describe("markStarted", () => {
  it("does nothing without a report, and marks an id once", async () => {
    const dir = plain();
    markStarted(dir, "x");
    expect(readScout(dir)).toBeNull();
    sdk.messages = ok([finding]);
    await startScout(dir);
    markStarted(dir, "x");
    markStarted(dir, "x");
    expect(readScout(dir)?.started).toEqual(["x"]);
  });
});
