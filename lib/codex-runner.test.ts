// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { permissionArgs } from "./codex-permissions";
import "./runner"; // codex-runner and runner-session import each other; entering through runner.ts is the order they expect
import { mcpResult, promptFor, toolUse } from "./codex-runner";
import type { Session } from "./runner-state";

vi.mock("./settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./settings")>()),
  subagentModel: () => undefined,
  threadPrompt: () => "THREAD PROMPT",
}));

describe("Codex permission arguments", () => {
  it("lets approve-for-me select its own workspace-write sandbox", () => {
    expect(permissionArgs("auto")).toEqual(["--approve-for-me"]);
  });
});

describe("Codex prompt", () => {
  let dir: string;
  const session = (sessionId?: string) => ({ sessionId, spec: { cwd: dir } }) as unknown as Session;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-prompt-"));
    fs.writeFileSync(path.join(dir, "CLAUDE.md"), "DECKCP RULES");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("starts a new Codex session with the project's CLAUDE.md, which Codex doesn't load", () => {
    const text = promptFor(session(), "hello");
    expect(text).toContain("DECKCP RULES");
    expect(text.indexOf("DECKCP RULES")).toBeLessThan(text.indexOf("THREAD PROMPT"));
    expect(text.endsWith("hello")).toBe(true);
  });

  it("leaves it out of a resumed session, whose history already has it", () => {
    expect(promptFor(session("thread-1"), "hello")).not.toContain("DECKCP RULES");
  });

  it("adds nothing when the folder has no CLAUDE.md", () => {
    fs.rmSync(path.join(dir, "CLAUDE.md"));
    // (Weft's own skills still get listed, so the reminder itself stays.)
    expect(promptFor(session(), "hello")).not.toContain("Codex doesn't load CLAUDE.md");
  });
});

describe("Codex prompt skills and tools", () => {
  it("lists the folder's skills on a new session and none on a resumed one", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-skills-"));
    fs.mkdirSync(path.join(dir, ".claude/skills/deck"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".claude/skills/deck/SKILL.md"), "---\ndescription: Make a deck\n---\nDECK STEPS ${ARGUMENTS}");
    const fresh = { spec: { cwd: dir } } as unknown as Session;
    expect(promptFor(fresh, "hi")).toContain("- deck: Make a deck");
    expect(promptFor({ sessionId: "t", spec: { cwd: dir } } as unknown as Session, "hi")).not.toContain("- deck:");
    expect(promptFor(fresh, "/deck for investors")).toContain("DECK STEPS for investors");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("tells Codex Weft's tools are MCP servers, not missing", () => {
    const text = promptFor({ spec: { cwd: os.tmpdir() } } as unknown as Session, "hi");
    expect(text).toContain("mcp__browser__open_url");
    expect(text).not.toContain("unavailable in this backend");
  });
});

describe("Codex MCP tool calls", () => {
  const call = { id: "i1", type: "mcp_tool_call", server: "browser", tool: "open_url", arguments: { url: "http://x" }, status: "completed" };

  it("shows an MCP call under Claude's name for the tool", () => {
    expect(toolUse(call)).toEqual({ name: "mcp__browser__open_url", input: { url: "http://x" } });
    expect(toolUse({ ...call, arguments: undefined })).toEqual({ name: "mcp__browser__open_url", input: {} });
    expect(toolUse({ id: "c", type: "command_execution", command: "ls" })).toEqual({ name: "Bash", input: { command: "ls" } });
    expect(toolUse({ id: "c", type: "command_execution" })).toEqual({ name: "Bash", input: { command: "Codex command" } });
  });

  it("reads the text of a result and the message of an error", () => {
    expect(mcpResult({ ...call, result: { content: [{ type: "text", text: " a " }, { type: "image" }, { type: "text", text: "b" }] } })).toEqual({ result: "a \nb", isError: false });
    expect(mcpResult({ ...call, result: null, status: "failed" })).toEqual({ result: "", isError: true });
    expect(mcpResult({ ...call, error: { message: "boom" } })).toEqual({ result: "boom", isError: true });
    expect(mcpResult({ ...call, error: "plain" })).toEqual({ result: "plain", isError: true });
    expect(mcpResult({ ...call, error: {} })).toEqual({ result: "The tool failed.", isError: true });
  });
});
