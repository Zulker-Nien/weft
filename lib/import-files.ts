// Reading Claude Code's session files: where they live, what the tail of one says,
// and the status words the user puts in their titles (the SOUL's stages).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { firstLine } from "./format";
import { extractStatus } from "./status";
import { toPermissionMode, type PermissionMode } from "./types";
import { globalSingleton } from "./global-singleton";
import { blocksOf, type Tail } from "./import-state";

const CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
const PROJECTS_DIR = path.join(CONFIG_DIR, "projects");

// The status words of the user's session titles, like "GOING DEEPER - Weft desktop app".
const STAGES = new Map([
  ["PLANNING", "Planning"],
  ["PRE-BUILD REFACTORING", "Pre-build refactoring"],
  ["FIRST SHOT", "First shot"],
  ["GOING DEEPER", "Going deeper"],
  ["POLISHING", "Polishing"],
  ["POST-BUILD REFACTORING", "Post-build refactoring"],
  ["CLEANING UP", "Cleaning up"],
  ["DONE", "Done"],
]);

export function parseTitle(raw: string): { title: string; stage?: string } {
  const [, label, rest] = raw.trim().match(/^([A-Z][A-Z -]*[A-Z])\s+[-–—]\s+(.+)$/) ?? [];
  const stage = label ? STAGES.get(label) : undefined;
  return stage && rest ? { title: rest.trim(), stage } : { title: raw.trim() };
}

// sessionId → its .jsonl file.
export function sessionFiles(): Map<string, string> {
  const files = new Map<string, string>();
  let projects: string[] = [];
  try {
    projects = fs.readdirSync(PROJECTS_DIR);
  } catch {
    return files;
  }
  for (const project of projects) {
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(path.join(PROJECTS_DIR, project));
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.endsWith(".jsonl")) files.set(entry.slice(0, -6), path.join(PROJECTS_DIR, project, entry));
    }
  }
  return files;
}

// Cached by file mtime: a 1 MB file's tail (256 KB) costs one read.
const tailCache = globalSingleton("__weftTails", () => new Map<string, { mtimeMs: number; tail: Tail }>());

// A turn is in progress when the last message is a prompt, a tool call, or a tool result rather than
// the assistant's final reply. An interrupted turn, or a local command like /model, ended it.
function midTurn(lines: string[]): boolean {
  for (let i = lines.length - 1; i >= 0; i--) {
    const verdict = midTurnLine(lines[i] ?? "");
    if (verdict !== undefined) return verdict;
  }
  return false;
}

// One line's verdict on whether the turn is in progress: undefined to keep looking.
function midTurnLine(line: string): boolean | undefined {
  if (!/"type":"(user|assistant)"/.test(line)) return undefined;
  const record = parseSessionLine(line);
  if (!record || !isRelevantRecord(record)) return undefined;
  if (record.type === "assistant") return record.message?.stop_reason === "tool_use" || record.message?.stop_reason == null;
  if (record.isMeta) return undefined;
  if (userIsToolResult(record.message?.content)) return true;
  // A non-string text can't start with either marker, so it reads as empty here.
  return !/^(\[Request interrupted|<local-command-)/.test(userText(record.message?.content).trim());
}

function isRelevantRecord(record: { isSidechain?: boolean; type?: string }): boolean {
  return !record.isSidechain && (record.type === "user" || record.type === "assistant");
}

function userIsToolResult(content: unknown): boolean {
  return blocksOf(content).some((b) => b?.type === "tool_result");
}

function userText(content: unknown): string {
  if (typeof content === "string") return content;
  const found = blocksOf(content).find((b) => b?.type === "text")?.text;
  return typeof found === "string" ? found : "";
}

function parseSessionLine(line: string): { type?: string; isSidechain?: boolean; isMeta?: boolean; message?: { stop_reason?: string | null; content?: unknown } } | undefined {
  try {
    return JSON.parse(line) as ReturnType<typeof parseSessionLine> & object;
  } catch {
    return undefined;
  }
}

function lastReply(lines: string[]): string | undefined {
  for (let i = lines.length - 1; i >= 0; i--) {
    const raw = lines[i] ?? "";
    if (!raw.includes('"type":"assistant"')) continue;
    let record: { type?: string; isSidechain?: boolean; message?: { content?: unknown } };
    try {
      record = JSON.parse(raw) as typeof record;
    } catch {
      continue;
    }
    if (record.type !== "assistant" || record.isSidechain || !Array.isArray(record.message?.content)) continue;
    const text = blocksOf(record.message.content)
      .flatMap((b) => (b?.type === "text" && typeof b.text === "string" && b.text ? [b.text] : []))
      .join("\n");
    const line = firstLine(extractStatus(text).text);
    if (line) return line;
  }
  return undefined;
}

// The tail of a session file, cached by its modified time. (The time of the last message comes from
// the messages: apps rewrite session files without adding any.)
export function readTail(file: string): Tail | undefined {
  try {
    const stat = fs.statSync(file);
    const cached = tailCache.get(file);
    if (cached && cached.mtimeMs === stat.mtimeMs) return cached.tail;
    const length = Math.min(stat.size, 256 * 1024);
    const buffer = Buffer.alloc(length);
    const fd = fs.openSync(file, "r");
    try {
      fs.readSync(fd, buffer, 0, length, stat.size - length);
    } finally {
      fs.closeSync(fd);
    }
    const text = buffer.toString("utf8");
    const stamps = [...text.matchAll(/"timestamp":"([^"]+)"/g)];
    const last = stamps.at(-1)?.[1];
    const at = last === undefined ? NaN : Date.parse(last);
    if (Number.isNaN(at)) return undefined;
    const lines = text.split("\n");
    const tail = { at, busy: midTurn(lines), reply: lastReply(lines), mode: lastPermissionMode(text) };
    tailCache.set(file, { mtimeMs: stat.mtimeMs, tail });
    return tail;
  } catch {
    return undefined;
  }
}

// The last permission mode in a stretch of session file: user messages and "permission-mode"
// records carry the mode the session was in.
export function lastPermissionMode(text: string): PermissionMode | undefined {
  const modes = [...text.matchAll(/"permissionMode":"([A-Za-z]+)"/g)];
  for (let i = modes.length - 1; i >= 0; i--) {
    const mode = toPermissionMode(modes[i]?.[1]);
    if (mode) return mode;
  }
  return undefined;
}
