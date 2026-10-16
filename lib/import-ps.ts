// Finding Claude Code's running sessions on this machine: parses /bin/ps and reads
// the ~/.claude/sessions/<pid>.json files Claude Code writes while it's running.

import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
// Claude Code lists each running session here as <pid>.json, with whether it's busy, idle, or waiting.
const RUNNING_DIR = path.join(CONFIG_DIR, "sessions");

type SessionStatus = "busy" | "idle" | "waiting";
const SESSION_STATUSES: readonly unknown[] = ["busy", "idle", "waiting"];

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
      const entry = JSON.parse(fs.readFileSync(path.join(RUNNING_DIR, name), "utf8")) as { pid?: unknown; sessionId?: unknown; status?: unknown };
      if (typeof entry.pid !== "number" || typeof entry.sessionId !== "string") return [];
      const status = SESSION_STATUSES.includes(entry.status) ? (entry.status as SessionStatus) : undefined;
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
    for (const m of (match[3] ?? "").matchAll(/--(?:resume|session-id)[= ]([0-9a-f-]{36})/g)) if (m[1]) ids.add(m[1]);
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

export function openSessions(): Promise<OpenSessions> {
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
    for (const m of (match[3] ?? "").matchAll(/--(?:resume|session-id)[= ]([0-9a-f-]{36})/g)) {
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