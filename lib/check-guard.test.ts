import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { CHECK_GUARD_MATCHER, checkGuard, checkTarget, checkTool, checkVerdict, takesTurns } from "./check-guard";

const DIR = "/Users/me/dev/weft";
const yes = () => true;
const hits = (command: string, turns: (dir: string) => boolean = yes) => checkTarget(command, DIR, turns);

// A project whose scripts take turns, and one whose don't.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "check-guard-"));
const project = (name: string, scripts: Record<string, string>) => {
  const dir = path.join(root, name);
  fs.mkdirSync(path.join(dir, "lib"), { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ scripts }));
  return dir;
};
const locked = project("locked", { lint: "node scripts/one-at-a-time.mjs lint eslint", typecheck: "tsc --noEmit" });
const plain = project("plain", { lint: "eslint", typecheck: "tsc --noEmit" });
const bare = project("bare", {});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("checkTarget", () => {
  it.each([
    ["tsc --noEmit", "tsc"],
    ["tsc --noEmit -p .", "tsc"],
    ["./node_modules/.bin/tsc --noEmit", "tsc"],
    ["npx tsc --noEmit", "tsc"],
    ["npx --no-install tsc --noEmit", "tsc"],
    ["npx -p typescript tsc", "tsc"],
    ["pnpm exec tsc --noEmit", "tsc"],
    ["pnpm tsc", "tsc"],
    ["npm exec tsc", "tsc"],
    ["yarn tsc", "tsc"],
    ["node node_modules/typescript/bin/tsc --noEmit", "tsc"],
    ["eslint --max-warnings 0", "eslint"],
    ["eslint lib/a.ts", "eslint"],
    ["npx eslint lib/a.ts", "eslint"],
    ["pnpm dlx eslint .", "eslint"],
    ["cd lib && npx tsc", "tsc"],
    ["sh -c 'npx --no-install eslint .'", "eslint"],
    ["git status && npx tsc --noEmit | head", "tsc"],
  ])("refuses %s", (command, tool) => {
    expect(hits(command)).toBe(tool);
  });

  it.each([
    "pnpm typecheck",
    "pnpm lint",
    "pnpm lint lib/a.ts",
    "pnpm run typecheck",
    "pnpm test",
    "npx vitest run",
    "tsc --version",
    "npx tsc -v",
    "eslint --help",
    "eslint --print-config lib/a.ts",
    "tsc --showConfig",
    "node scripts/one-at-a-time.mjs typecheck 'tsc --noEmit'",
    "grep tsc package.json",
    "echo eslint",
  ])("lets %s through", (command) => {
    expect(hits(command)).toBeNull();
  });

  it("leaves projects that don't take turns alone", () => {
    expect(hits("npx tsc --noEmit", () => false)).toBeNull();
  });

  it("asks about the folder the step runs in", () => {
    const seen: string[] = [];
    checkTarget("cd lib && tsc", DIR, (dir) => (seen.push(dir), false));
    expect(seen).toEqual([path.join(DIR, "lib")]);
  });
});

describe("checkTool", () => {
  it("is null for a package manager or runner running something else", () => {
    expect(checkTool({ name: "pnpm", args: ["install"], cwd: DIR })).toBeNull();
    expect(checkTool({ name: "npx", args: [], cwd: DIR })).toBeNull();
    expect(checkTool({ name: "ls", args: ["tsc"], cwd: DIR })).toBeNull();
  });
});

describe("takesTurns", () => {
  it("is true when the nearest package.json's lint or typecheck goes through the lock, from any folder below it", () => {
    expect(takesTurns(locked)).toBe(true);
    expect(takesTurns(path.join(locked, "lib"))).toBe(true);
  });

  it("is false without the lock, without scripts, or without a package.json", () => {
    expect(takesTurns(plain)).toBe(false);
    expect(takesTurns(bare)).toBe(false);
    expect(takesTurns(path.parse(root).root)).toBe(false);
  });
});

describe("checkVerdict", () => {
  it("names the pnpm script to run instead", () => {
    expect(checkVerdict("npx tsc --noEmit", DIR, yes)).toMatch(/^Refused: run `pnpm typecheck` instead of tsc/);
    expect(checkVerdict("eslint lib/a.ts", DIR, yes)).toMatch(/^Refused: run `pnpm lint` \(or `pnpm lint <your files>`/);
    expect(checkVerdict("pnpm lint", DIR, yes)).toBeNull();
  });

  it("reads the real package.json by default", () => {
    expect(checkVerdict("npx tsc", locked)).toMatch(/pnpm typecheck/);
    expect(checkVerdict("npx tsc", plain)).toBeNull();
  });
});

describe("checkGuard", () => {
  const call = (input: Record<string, unknown>) => checkGuard(input as never, undefined, { signal: new AbortController().signal });

  it("denies a direct check in a project that takes turns", async () => {
    const out = await call({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "npx tsc --noEmit" }, cwd: locked });
    expect(out).toMatchObject({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny" } });
  });

  it("lets everything else through", async () => {
    expect(await call({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "pnpm typecheck" }, cwd: locked })).toEqual({});
    expect(await call({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "npx tsc" }, cwd: plain })).toEqual({});
    expect(await call({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: {}, cwd: locked })).toEqual({});
    expect(await call({ hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { command: "npx tsc" }, cwd: locked })).toEqual({});
    expect(await call({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "npx tsc" }, cwd: locked })).toEqual({});
  });

  it("matches Bash", () => {
    expect(CHECK_GUARD_MATCHER.matcher).toBe("Bash");
    expect(CHECK_GUARD_MATCHER.hooks).toEqual([checkGuard]);
  });
});
