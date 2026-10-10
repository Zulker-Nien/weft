import { execFile, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getSessionMessages, listSessions } from "@anthropic-ai/claude-agent-sdk";
import { dismissedSessions } from "./settings";
import { firstLine } from "./format";
import { extractStatus } from "./status";
import { addCards, getThread, listCards, replaceThread, updateCard } from "./store";
import { transcriptToThread } from "./transcript";
import { toPermissionMode, type Card, type Column, type PermissionMode } from "./types";

// Picks up the user's existing Claude Code sessions (the ones /resume and the Claude app list) as
// cards, keeps them in sync, and loads a session's transcript into its thread when it's opened.

const CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
const PROJECTS_DIR = path.join(CONFIG_DIR, "projects");
// Claude Code lists each running session here as <pid>.json, with whether it's busy, idle, or waiting.
const RUNNING_DIR = path.join(CONFIG_DIR, "sessions");
const RECENT_MS = 3 * 24 * 60 * 60_000;
const SYNC_EVERY_MS = 60_000;
// Between full syncs, how often changed session files are checked for a turn starting or ending.
const CHECK_EVERY_MS = 5_000;
// A session mid-turn counts as running if it changed this recently, even when no open app shows it.
const RUNNING_QUIET_MS = 2 * 60_000;
const TEMP_DIRS = [os.tmpdir(), "/tmp/", "/private/tmp/", "/private/var/folders/"];

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
  const match = raw.trim().match(/^([A-Z][A-Z -]*[A-Z])\s+[-–—]\s+(.+)$/);
  const stage = match ? STAGES.get(match[1]) : undefined;
  return stage && match ? { title: match[2].trim(), stage } : { title: raw.trim() };
}

function columnFor(stage: string | undefined, lastActivity: number, live?: Column): Column {
  if (live) return live;
  if (stage === "Done") return "done";
  if (stage) return "review";
  return Date.now() - lastActivity < RECENT_MS ? "review" : "done";
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

// What the end of a session file says: when its last message was, and whether a turn is in progress.
interface Tail {
  at: number;
  busy: boolean;
  // The first line of the assistant's last reply, for the card.
  reply?: string;
  // The permission mode Claude Code last recorded for the session.
  mode?: PermissionMode;
}

const g = globalThis as unknown as {
  __weftTails?: Map<string, { mtimeMs: number; tail: Tail }>;
  __weftSync?: Promise<SyncResult>;
  __weftSyncTimer?: ReturnType<typeof setInterval>;
  __weftCheckTimer?: ReturnType<typeof setInterval>;
  __weftLive?: Set<string>;
};
const tailCache = (g.__weftTails ??= new Map());
// Cards the sync put in Running or Needs you because their session was live in another app, so it
// moves them back when that ends (and leaves cards the user moved there alone).
const liveCards = (g.__weftLive ??= new Set<string>());

// A turn is in progress when the last message is a prompt, a tool call, or a tool result rather than
// the assistant's final reply. An interrupted turn, or a local command like /model, ended it.
function midTurn(lines: string[]): boolean {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!/"type":"(user|assistant)"/.test(lines[i])) continue;
    let record: { type?: string; isSidechain?: boolean; isMeta?: boolean; message?: { stop_reason?: string | null; content?: unknown } };
    try {
      record = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (record.isSidechain || (record.type !== "user" && record.type !== "assistant")) continue;
    if (record.type === "assistant") return record.message?.stop_reason === "tool_use" || record.message?.stop_reason == null;
    if (record.isMeta) continue;
    const content = record.message?.content;
    if (Array.isArray(content) && content.some((b) => b?.type === "tool_result")) return true;
    const text = typeof content === "string" ? content : Array.isArray(content) ? (content.find((b) => b?.type === "text")?.text ?? "") : "";
    return !/^(\[Request interrupted|<local-command-)/.test(String(text).trim());
  }
  return false;
}

function lastReply(lines: string[]): string | undefined {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('"type":"assistant"')) continue;
    let record: { type?: string; isSidechain?: boolean; message?: { content?: unknown } };
    try {
      record = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (record.type !== "assistant" || record.isSidechain || !Array.isArray(record.message?.content)) continue;
    const text = (record.message.content as { type?: string; text?: string }[])
      .flatMap((b) => (b?.type === "text" && b.text ? [b.text] : []))
      .join("\n");
    const line = firstLine(extractStatus(text).text);
    if (line) return line;
  }
  return undefined;
}

// The tail of a session file, cached by its modified time. (The time of the last message comes from
// the messages: apps rewrite session files without adding any.)
function readTail(file: string): Tail | undefined {
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
    const at = stamps.length ? Date.parse(stamps[stamps.length - 1][1]) : NaN;
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
    const mode = toPermissionMode(modes[i][1]);
    if (mode) return mode;
  }
  return undefined;
}

// The user's default mode for new Claude Code sessions (permissions.defaultMode).
function defaultMode(): PermissionMode | undefined {
  try {
    const settings = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, "settings.json"), "utf8"));
    return toPermissionMode(settings?.permissions?.defaultMode);
  } catch {
    return undefined;
  }
}

// The mode a picked-up session continues in: the one it last ran in, so resuming it doesn't start
// asking about every command. The tail usually has it; otherwise the file's start, then the user's
// default, then "default".
export function sessionMode(file: string | undefined, tailMode?: PermissionMode): PermissionMode {
  if (tailMode) return tailMode;
  if (file) {
    try {
      const fd = fs.openSync(file, "r");
      try {
        const buffer = Buffer.alloc(256 * 1024);
        const read = fs.readSync(fd, buffer, 0, buffer.length, 0);
        const mode = lastPermissionMode(buffer.subarray(0, read).toString("utf8"));
        if (mode) return mode;
      } finally {
        fs.closeSync(fd);
      }
    } catch {}
  }
  return defaultMode() ?? "default";
}

type SessionStatus = "busy" | "idle" | "waiting";

// The sessions open in another app right now (the Claude app or a terminal), and what Claude Code
// reports each is doing.
interface OpenSessions {
  ids: Set<string>;
  status: Map<string, SessionStatus>;
}

// Claude Code's list of its running sessions. Entries can outlive their process, so callers check
// the pid is still running.
function runningEntries(): { pid: number; sessionId: string; status?: SessionStatus }[] {
  let names: string[] = [];
  try {
    names = fs.readdirSync(RUNNING_DIR).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }
  return names.flatMap((name) => {
    try {
      const entry = JSON.parse(fs.readFileSync(path.join(RUNNING_DIR, name), "utf8"));
      if (typeof entry.pid !== "number" || typeof entry.sessionId !== "string") return [];
      const status = ["busy", "idle", "waiting"].includes(entry.status) ? (entry.status as SessionStatus) : undefined;
      return [{ pid: entry.pid, sessionId: entry.sessionId, status }];
    } catch {
      return [];
    }
  });
}

function openSessionsIn(psOutput: string): OpenSessions {
  const ids = new Set<string>();
  const status = new Map<string, SessionStatus>();
  const parents = new Map<number, number>();
  for (const line of psOutput.split("\n")) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
    if (!match) continue;
    parents.set(Number(match[1]), Number(match[2]));
    // Weft's own CLIs are children of this server process.
    if (Number(match[2]) === process.pid) continue;
    for (const m of match[3].matchAll(/--(?:resume|session-id)[= ]([0-9a-f-]{36})/g)) ids.add(m[1]);
  }
  // A session the Claude app started fresh has no id on its command line, so this list is the only
  // place it shows up.
  for (const entry of runningEntries()) {
    const parent = parents.get(entry.pid);
    if (parent === undefined || parent === process.pid) continue;
    ids.add(entry.sessionId);
    if (entry.status) status.set(entry.sessionId, entry.status);
  }
  return { ids, status };
}

function openSessions(): Promise<OpenSessions> {
  return new Promise((resolve) => {
    execFile("/bin/ps", ["-axo", "pid=,ppid=,command="], { maxBuffer: 16 * 1024 * 1024 }, (err, stdout) =>
      resolve(err ? { ids: new Set(), status: new Map() } : openSessionsIn(stdout)),
    );
  });
}

export function isOpenElsewhere(sessionId: string) {
  try {
    const out = execFileSync("/bin/ps", ["-axo", "pid=,ppid=,command="], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    return openSessionsIn(out).ids.has(sessionId);
  } catch {
    return false;
  }
}

// Stops the Claude CLIs outside Weft that hold a session (a terminal, or the Claude app's), so the
// card can continue it in place. Returns how many were stopped.
export function releaseSession(sessionId: string): number {
  let out = "";
  try {
    out = execFileSync("/bin/ps", ["-axo", "pid=,ppid=,command="], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  } catch {
    return 0;
  }
  const pids = new Set<number>();
  const parents = new Map<number, number>();
  for (const line of out.split("\n")) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
    if (!match) continue;
    parents.set(Number(match[1]), Number(match[2]));
    if (Number(match[2]) === process.pid) continue;
    for (const m of match[3].matchAll(/--(?:resume|session-id)[= ]([0-9a-f-]{36})/g)) {
      if (m[1] === sessionId) pids.add(Number(match[1]));
    }
  }
  for (const entry of runningEntries()) {
    const parent = parents.get(entry.pid);
    if (entry.sessionId === sessionId && parent !== undefined && parent !== process.pid) pids.add(entry.pid);
  }
  let stopped = 0;
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
      stopped += 1;
    } catch {}
  }
  return stopped;
}

// Where a session that's live in another app belongs: Running while a turn runs, Needs you while it
// waits for an answer there. Without Claude Code's report, an unfinished turn in the session file
// counts if the session is open or changed in the last two minutes (a CLI that quit mid-turn leaves
// its last turn unfinished for good).
function liveColumn(sessionId: string, tail: Tail | undefined, open: OpenSessions): Column | undefined {
  const status = open.status.get(sessionId);
  if (status) return status === "busy" ? "running" : status === "waiting" ? "needs_you" : undefined;
  return tail?.busy && (open.ids.has(sessionId) || Date.now() - tail.at < RUNNING_QUIET_MS) ? "running" : undefined;
}

// Moves a picked-up card when its session changed outside Weft, or went live or quiet there.
// Otherwise it stays where the user put it. Weft's own runs (warm) and pending requests are left alone.
const LIVE_LINES: Partial<Record<Column, string>> = {
  running: "Working in another app",
  needs_you: "Waiting for you in another app",
};

function columnPatch(card: Card, activity: number, live: Column | undefined, stage = card.stage, reply?: string): Partial<Card> {
  if (card.warm || card.pending) return {};
  const outside = activity > (card.lastActivity ?? 0) + 1000;
  if (!outside && !live && !liveCards.has(card.id)) return {};
  if (live) liveCards.add(card.id);
  else liveCards.delete(card.id);
  const column = columnFor(stage, activity, live);
  const patch: Partial<Card> = column === card.column ? {} : { column };
  const line = live ? LIVE_LINES[live] : reply;
  if (line && line !== card.lastLine) patch.lastLine = line;
  return patch;
}

export interface SyncResult {
  sessions: number;
  added: number;
  updated: number;
}

async function runSync(): Promise<SyncResult> {
  const [sessions, open] = await Promise.all([
    listSessions({ includeProgrammatic: false, limit: 10_000 }),
    openSessions(),
  ]);
  const files = sessionFiles();
  const cards = new Map<string, Card>();
  for (const c of listCards()) {
    if (c.sessionId) cards.set(c.sessionId, c);
    if (c.forkedFrom) cards.set(c.forkedFrom, c);
  }
  const dismissed = new Set(dismissedSessions());
  const added: Card[] = [];
  let updated = 0;

  for (const session of sessions) {
    if (dismissed.has(session.sessionId)) continue;
    // Sessions in temporary folders are tooling runs (tests, subagents), not the user's threads.
    if (TEMP_DIRS.some((dir) => (session.cwd ?? "").startsWith(dir))) continue;
    const file = files.get(session.sessionId);
    const tail = file ? readTail(file) : undefined;
    const activity = tail?.at || session.createdAt || session.lastModified;
    const { title, stage } = parseTitle(session.customTitle || session.summary || session.firstPrompt || "Untitled thread");
    const openElsewhere = open.ids.has(session.sessionId);
    const live = liveColumn(session.sessionId, tail, open);
    const existing = cards.get(session.sessionId);

    if (!existing) {
      added.push({
        id: randomUUID(),
        title,
        prompt: session.firstPrompt ?? "",
        cwd: session.cwd ?? os.homedir(),
        backend: "claude",
        permissionMode: sessionMode(file, tail?.mode),
        column: columnFor(stage, activity, live),
        sessionId: session.sessionId,
        stage,
        source: "claude-code",
        lastActivity: activity,
        openElsewhere,
        lastLine: (live && LIVE_LINES[live]) || (session.firstPrompt ? firstLine(session.firstPrompt) : undefined),
        createdAt: session.createdAt ?? activity,
        updatedAt: activity,
      });
      continue;
    }
    // Weft's own cards, and cards that continued a session as a copy, don't follow the original.
    if (existing.source !== "claude-code" || existing.forkedFrom === session.sessionId) continue;

    const patch: Partial<Card> = {};
    if (Boolean(existing.openElsewhere) !== openElsewhere) patch.openElsewhere = openElsewhere;
    // New messages or a new title from outside Weft move the card, unless Weft has the thread open.
    Object.assign(patch, columnPatch(existing, activity, live, stage, tail?.reply));
    const outside = activity > (existing.lastActivity ?? 0) + 1000;
    if (outside && !existing.warm) {
      Object.assign(patch, { title, stage, lastActivity: activity });
    } else if (!existing.warm && (title !== existing.title || stage !== existing.stage)) {
      Object.assign(patch, { title, stage });
    }
    if (Object.keys(patch).length) {
      updateCard(existing.id, patch);
      updated += 1;
    }
  }

  if (added.length) addCards(added);
  return { sessions: sessions.length, added: added.length, updated };
}

// One sync at a time; callers share the one in progress.
export function syncSessions(): Promise<SyncResult> {
  g.__weftSync ??= runSync().finally(() => {
    g.__weftSync = undefined;
  });
  return g.__weftSync;
}

// A quick look between full syncs, so a session that starts or ends a turn in another app, or stops
// there to ask the user something, moves its card within seconds.
async function checkLive() {
  if (g.__weftSync) return;
  const files = sessionFiles();
  const open = await openSessions();
  for (const card of listCards()) {
    if (card.source !== "claude-code" || !card.sessionId || card.forkedFrom) continue;
    const file = files.get(card.sessionId);
    const tail = file ? readTail(file) : undefined;
    if (!tail) continue;
    const patch = columnPatch(card, tail.at, liveColumn(card.sessionId, tail, open), card.stage, tail.reply);
    if (!card.warm && tail.at > (card.lastActivity ?? 0) + 1000) patch.lastActivity = tail.at;
    if (Boolean(card.openElsewhere) !== open.ids.has(card.sessionId)) patch.openElsewhere = open.ids.has(card.sessionId);
    if (Object.keys(patch).length) updateCard(card.id, patch);
  }
}

// Syncs now and then every minute, once per server process, checking for live sessions in between.
export function startSessionSync() {
  if (g.__weftSyncTimer) return;
  g.__weftSyncTimer = setInterval(() => void syncSessions().catch(() => {}), SYNC_EVERY_MS);
  g.__weftCheckTimer = setInterval(() => void checkLive().catch(() => {}), CHECK_EVERY_MS);
  void syncSessions().catch((err) => console.error("Session sync failed:", err));
}

// Reads a picked-up session's transcript into its thread, when it changed since the last read.
export async function loadTranscript(card: Card) {
  if (card.source !== "claude-code" || !card.sessionId || card.warm) return;
  const activity = card.lastActivity ?? card.updatedAt;
  if (card.transcriptAt && card.transcriptAt >= activity && getThread(card.id).length) return;
  const cwdExists = fs.existsSync(card.cwd);
  const messages = await getSessionMessages(card.sessionId, cwdExists ? { dir: card.cwd } : undefined);
  replaceThread(card.id, transcriptToThread(messages, { cwd: card.cwd }));
  updateCard(card.id, { transcriptAt: activity });
}
