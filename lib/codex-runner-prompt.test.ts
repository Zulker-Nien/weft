// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./runner"; // codex-runner and runner-session import each other; entering through runner.ts is the order they expect
import { CODEX_PROMPT_CODE, argsFor, promptFor } from "./codex-runner-prompt";
import { CODEX_DEFAULT_MODEL } from "./new-thread";
import type { Session } from "./runner-state";
import type { Card } from "./types";

const cards = new Map<string, Partial<Card>>();
vi.mock("./store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./store")>()),
  getCard: (id: string) => cards.get(id),
}));

let projectDir: string;
beforeEach(() => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-prompt-"));
  cards.clear();
});
afterEach(() => fs.rmSync(projectDir, { recursive: true, force: true }));

const session = (over: Record<string, unknown> = {}, spec: Record<string, unknown> = {}) =>
  ({ spec: { cwd: "/proj", permissionMode: "default", ...spec }, ...over }) as unknown as Session;

describe("argsFor", () => {
  it("starts a new session with the folder, model, images, effort and sandbox", () => {
    const args = argsFor(session({}, { model: "gpt-5", effort: "high", permissionMode: "acceptEdits" }), ["a.png", "b.png"], ["--config", "mcp"]);
    expect(args).toEqual([
      "exec", "--json", "--cd", "/proj", "--skip-git-repo-check", "--config", "mcp",
      "--model", "gpt-5", "--image", "a.png", "--image", "b.png",
      "--config", 'model_reasoning_effort="high"',
      "--sandbox", "workspace-write", "--config", 'approval_policy="never"', "-",
    ]);
  });

  it("leaves out the model for the default and effort when unset", () => {
    const args = argsFor(session({}, { model: CODEX_DEFAULT_MODEL }), []);
    expect(args).not.toContain("--model");
    expect(args).not.toContain("model_reasoning_effort");
    expect(args.at(-1)).toBe("-");
  });

  it("prefers the card's own model, effort and permission mode", () => {
    cards.set("c1", { model: "card-model", effort: "low", permissionMode: "auto" });
    const args = argsFor(session({ cardId: "c1" }, { model: "spec-model", effort: "high" }), []);
    expect(args).toContain("card-model");
    expect(args).toContain('model_reasoning_effort="low"');
    expect(args).toContain("--approve-for-me");
  });

  it("resumes a saved session by id, keeping only the model and images", () => {
    const fromSession = argsFor(session({ sessionId: "s1" }, { model: "m" }), ["i.png"], ["--config", "x"]);
    expect(fromSession).toEqual(["exec", "resume", "--json", "--config", "x", "--model", "m", "--image", "i.png", "s1", "-"]);
    expect(argsFor(session({}, { sessionId: "s2" }), [])).toEqual(["exec", "resume", "--json", "s2", "-"]);
  });
});

describe("promptFor", () => {
  it("wraps the text in Weft's instructions", () => {
    const text = promptFor(session({}, { cwd: "/nonexistent-weft-test-dir" }), "hello");
    expect(text).toContain("You are a Codex CLI thread managed by Weft");
    expect(text.endsWith("hello")).toBe(true);
  });

  it("drops project skills named in the spec's skillsOff from the skills list", () => {
    fs.mkdirSync(path.join(projectDir, ".claude", "skills", "deck"), { recursive: true });
    fs.writeFileSync(path.join(projectDir, ".claude", "skills", "deck", "SKILL.md"), "---\ndescription: Make a deck\n---\n");
    fs.mkdirSync(path.join(projectDir, ".claude", "skills", "slide"), { recursive: true });
    fs.writeFileSync(path.join(projectDir, ".claude", "skills", "slide", "SKILL.md"), "---\ndescription: Make a slide\n---\n");
    const text = promptFor(session({}, { cwd: projectDir, skillsOff: ["deck"] }), "hello");
    expect(text).toContain("# Skills");
    expect(text).toContain("- slide: Make a slide");
    expect(text).not.toContain("- deck:");
  });
});

it("hands the runner's BUILD fingerprint the module's functions", () => {
  expect(CODEX_PROMPT_CODE).toContain(promptFor);
  expect(CODEX_PROMPT_CODE).toContain(argsFor);
});
