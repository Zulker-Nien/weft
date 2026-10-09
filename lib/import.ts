import { execFile, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getSessionMessages, listSessions } from "@anthropic-ai/claude-agent-sdk";
import { dismissedSessions } from "./settings";
import { addCards, getThread, listCards, replaceThread, updateCard } from "./store";
import { transcriptToThread } from "./transcript";
import type { Card, Column } from "./types";

// Picks up the user's existing Claude Code sessions (the ones /resume and the Claude app list) as
// cards, keeps them in sync, and loads a session's transcript into its thread when it's opened.

const PROJECTS_DIR = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"), "projects");
const RECENT_MS = 3 * 24 * 60 * 60_000;
const SYNC_EVERY_MS = 60_000;
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

function columnFor(stage: string | undefined, lastActivity: number): Column {
  if (stage === "Done") return "done";
  if (stage) return "review";
  return Date.now() - lastActivity < RECENT_MS ? "review" : "done";
}

function clip(text: string, max: number) {
  const line = text.split("\n").find((l) => l.trim())?.trim() ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

// sessionId → its .jsonl file.
function sessionFiles(): Map<string, string> {
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

const g = globalThis as unknown as {
  __weftActivity?: Map<string, { mtimeMs: number; at: number }>;
  __weftSync?: Promise<SyncResult>;
  __weftSyncTimer?: ReturnType<typeof setInterval>;
};
const activityCache = (g.__weftActivity ??= new Map());

// The timestamp of a session's last message, read from the end of its file. (File times aren't
// reliable: apps rewrite session files without new messages.)
function lastActivity(file: string): number | undefined {
  try {
    const stat = fs.statSync(file);
    const cached = activityCache.get(file);
    if (cached && cached.mtimeMs === stat.mtimeMs) return cached.at;
    const length = Math.min(stat.size, 256 * 1024);
    const buffer = Buffer.alloc(length);
    const fd = fs.openSync(file, "r");
    try {
      fs.readSync(fd, buffer, 0, length, stat.size - length);
    } finally {
      fs.closeSync(fd);
    }
    const stamps = [...buffer.toString("utf8").matchAll(/"timestamp":"([^"]+)"/g)];
    const at = stamps.length ? Date.parse(stamps[stamps.length - 1][1]) : NaN;
    if (Number.isNaN(at)) return undefined;
    activityCache.set(file, { mtimeMs: stat.mtimeMs, at });
    return at;
  } catch {
    return undefined;
  }
}

function sessionIdsIn(psOutput: string): Set<string> {
  const ids = new Set<string>();
  for (const line of psOutput.split("\n")) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
    if (!match) continue;
    // Weft's own CLIs are children of this server process.
    if (Number(match[2]) === process.pid) continue;
    for (const m of match[3].matchAll(/--(?:resume|session-id)[= ]([0-9a-f-]{36})/g)) ids.add(m[1]);
  }
  return ids;
}

// Sessions open in another app right now (the Claude app or a terminal), from their command lines.
function openSessionIds(): Promise<Set<string>> {
  return new Promise((resolve) => {
    execFile("/bin/ps", ["-axo", "pid=,ppid=,command="], { maxBuffer: 16 * 1024 * 1024 }, (err, stdout) =>
      resolve(err ? new Set() : sessionIdsIn(stdout)),
    );
  });
}

export function isOpenElsewhere(sessionId: string) {
  try {
    const out = execFileSync("/bin/ps", ["-axo", "pid=,ppid=,command="], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    return sessionIdsIn(out).has(sessionId);
  } catch {
    return false;
  }
}

export interface SyncResult {
  sessions: number;
  added: number;
  updated: number;
}

async function runSync(): Promise<SyncResult> {
  const [sessions, open] = await Promise.all([
    listSessions({ includeProgrammatic: false, limit: 10_000 }),
    openSessionIds(),
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
    const activity = (file && lastActivity(file)) || session.createdAt || session.lastModified;
    const { title, stage } = parseTitle(session.customTitle || session.summary || session.firstPrompt || "Untitled thread");
    const openElsewhere = open.has(session.sessionId);
    const existing = cards.get(session.sessionId);

    if (!existing) {
      added.push({
        id: randomUUID(),
        title,
        prompt: session.firstPrompt ?? "",
        cwd: session.cwd ?? os.homedir(),
        backend: "claude",
        permissionMode: "default",
        column: columnFor(stage, activity),
        sessionId: session.sessionId,
        stage,
        source: "claude-code",
        lastActivity: activity,
        openElsewhere,
        lastLine: session.firstPrompt ? clip(session.firstPrompt, 140) : undefined,
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
    const outside = activity > (existing.lastActivity ?? 0) + 1000;
    if (outside && !existing.warm) {
      Object.assign(patch, { title, stage, lastActivity: activity });
      if (existing.column !== "running" && !existing.pending) patch.column = columnFor(stage, activity);
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

// Syncs now and then every minute, once per server process.
export function startSessionSync() {
  if (g.__weftSyncTimer) return;
  g.__weftSyncTimer = setInterval(() => void syncSessions().catch(() => {}), SYNC_EVERY_MS);
  void syncSessions().catch((err) => console.error("Session sync failed:", err));
}

// Reads a picked-up session's transcript into its thread, when it changed since the last read.
export async function loadTranscript(card: Card) {
  if (card.source !== "claude-code" || !card.sessionId || card.warm) return;
  const activity = card.lastActivity ?? card.updatedAt;
  if (card.transcriptAt && card.transcriptAt >= activity && getThread(card.id).length) return;
  const cwdExists = fs.existsSync(card.cwd);
  const messages = await getSessionMessages(card.sessionId, cwdExists ? { dir: card.cwd } : undefined);
  replaceThread(card.id, transcriptToThread(messages));
  updateCard(card.id, { transcriptAt: activity });
}
