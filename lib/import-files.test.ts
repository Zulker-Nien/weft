import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { lastPermissionMode, parseTitle, readTail, sessionFiles } from "./import-files";

// import-files reads CLAUDE_CONFIG_DIR when it loads, so the path is set before the import runs.
const dir = vi.hoisted(() => {
  const root = `${process.env.TMPDIR ?? "/tmp"}/weft-import-files-${process.pid}`;
  process.env.CLAUDE_CONFIG_DIR = `${root}/claude`;
  return root;
});
const config = path.join(dir, "claude");
fs.mkdirSync(dir, { recursive: true });
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

let n = 0;
function tailOf(...records: (object | string)[]) {
  const file = path.join(dir, `s${n++}.jsonl`);
  fs.writeFileSync(file, records.map((r) => (typeof r === "string" ? r : JSON.stringify(r))).join("\n"));
  return readTail(file);
}
const ts = { timestamp: "2026-01-01T00:00:00.000Z" };

describe("parseTitle", () => {
  it("splits a stage label off a title", () => {
    expect(parseTitle("GOING DEEPER - Weft app")).toEqual({ title: "Weft app", stage: "Going deeper" });
    expect(parseTitle("  plain title ")).toEqual({ title: "plain title" });
    expect(parseTitle("NOPE - thing")).toEqual({ title: "NOPE - thing" });
  });
});

describe("sessionFiles", () => {
  it("is empty when there is no projects folder", () => {
    expect(sessionFiles().size).toBe(0);
  });

  it("maps session ids to their .jsonl files, skipping other files and unreadable entries", () => {
    fs.mkdirSync(path.join(config, "projects", "p1"), { recursive: true });
    fs.writeFileSync(path.join(config, "projects", "p1", "abc.jsonl"), "");
    fs.writeFileSync(path.join(config, "projects", "p1", "notes.txt"), "");
    fs.writeFileSync(path.join(config, "projects", "afile"), "");
    expect([...sessionFiles()]).toEqual([["abc", path.join(config, "projects", "p1", "abc.jsonl")]]);
  });
});

describe("readTail", () => {
  it("is undefined for a missing file or one with no timestamp", () => {
    expect(readTail(path.join(dir, "missing.jsonl"))).toBeUndefined();
    expect(tailOf({ type: "user" })).toBeUndefined();
  });

  it("is not busy when nothing in the tail is a relevant message", () => {
    expect(tailOf({ type: "summary", ...ts })?.busy).toBe(false);
    expect(tailOf({ type: "user", isSidechain: true, ...ts })?.busy).toBe(false);
  });

  it("skips unparseable lines and meta users", () => {
    const t = tailOf('{"type":"user" broken', { type: "user", isMeta: true, ...ts });
    expect(t?.busy).toBe(false);
  });

  it("is busy after a prompt, tool result, or tool_use, idle after a final reply", () => {
    expect(tailOf({ type: "user", message: { content: "hi" }, ...ts })?.busy).toBe(true);
    expect(tailOf({ type: "user", message: { content: [{ type: "tool_result" }] }, ...ts })?.busy).toBe(true);
    expect(tailOf({ type: "assistant", message: { stop_reason: "tool_use", content: [] }, ...ts })?.busy).toBe(true);
    expect(tailOf({ type: "assistant", message: { stop_reason: null, content: [] }, ...ts })?.busy).toBe(true);
    expect(tailOf({ type: "assistant", message: { stop_reason: "end_turn", content: [] }, ...ts })?.busy).toBe(false);
  });

  it("treats interruptions and local commands as the end of a turn", () => {
    expect(tailOf({ type: "user", message: { content: "[Request interrupted by user]" }, ...ts })?.busy).toBe(false);
    expect(tailOf({ type: "user", message: { content: [{ type: "text", text: "<local-command-stdout>" }] }, ...ts })?.busy).toBe(false);
    expect(tailOf({ type: "user", message: { content: [{ type: "text", text: 5 }] }, ...ts })?.busy).toBe(true);
  });

  it("finds the last reply's first line, skipping status-only and sidechain ones", () => {
    const t = tailOf(
      { type: "assistant", message: { stop_reason: "end_turn", content: [{ type: "text", text: "First line\nsecond" }] }, ...ts },
      "not json but has \"type\":\"assistant\"",
      { type: "assistant", isSidechain: true, message: { content: [{ type: "text", text: "side" }] }, ...ts },
      { type: "assistant", message: { stop_reason: "end_turn", content: "string" }, ...ts },
      { type: "assistant", message: { stop_reason: "end_turn", content: [{ type: "text", text: "" }, { type: "tool_use" }] }, ...ts },
    );
    expect(t?.reply).toBe("First line");
  });

  it("caches by mtime and reads the permission mode", () => {
    const file = path.join(dir, "cached.jsonl");
    fs.writeFileSync(file, JSON.stringify({ type: "user", permissionMode: "plan", message: { content: "hi" }, ...ts }));
    const a = readTail(file);
    expect(a?.mode).toBe("default");
    expect(readTail(file)).toBe(a);
  });
});

describe("lastPermissionMode", () => {
  it("takes the last known mode", () => {
    expect(lastPermissionMode('"permissionMode":"auto" "permissionMode":"weird"')).toBe("auto");
    expect(lastPermissionMode("nothing")).toBeUndefined();
  });
});
