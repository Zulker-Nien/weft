import fs from "node:fs";
import path from "node:path";
import { globalSingleton } from "./global-singleton";
import { DATA_DIR } from "./store";
import type { LimitKind, LimitSample } from "./limit-chart";
import type { Backend, CardStats } from "./types";

// The plan limits over time, for the status strip's burndown chart (components/LimitBurndown.tsx): a
// card only keeps the latest 5-hour and weekly window, so each change is also appended to
// ~/.weft/limits.jsonl, one sample per line, per CLI. A week and a day of it is kept.

export const LIMITS_FILE = path.join(DATA_DIR, "limits.jsonl");
export const KEEP_MS = 8 * 24 * 60 * 60 * 1000;

interface Log {
  last: Map<string, LimitSample>;
  compacted: boolean;
}

const log = () => globalSingleton<Log>("__weftLimits", () => ({ last: new Map(), compacted: false }));

const key = (backend: Backend, kind: LimitKind) => `${backend}:${kind}`;

function parse(line: string): LimitSample | null {
  try {
    const s = JSON.parse(line) as LimitSample;
    return typeof s.at === "number" && typeof s.used === "number" && typeof s.kind === "string" && typeof s.backend === "string" ? s : null;
  } catch {
    return null;
  }
}

// Every sample still kept, oldest first; the first read of a process drops the older lines from the file.
export function readSamples(now = Date.now()): LimitSample[] {
  let text = "";
  try {
    text = fs.readFileSync(LIMITS_FILE, "utf8");
  } catch {
    return [];
  }
  const all = text.split("\n").filter(Boolean).map(parse).filter((s): s is LimitSample => s !== null);
  const kept = all.filter((s) => now - s.at <= KEEP_MS);
  const l = log();
  if (!l.compacted) {
    l.compacted = true;
    if (kept.length < all.length) fs.writeFileSync(LIMITS_FILE, kept.map((s) => JSON.stringify(s)).join("\n") + (kept.length ? "\n" : ""));
  }
  return kept.sort((a, b) => a.at - b.at);
}

// The samples a stats patch adds: a window whose share or reset changed since the last one seen.
export function changedSamples(backend: Backend, patch: Partial<CardStats>, last: Map<string, LimitSample>, now: number): LimitSample[] {
  const windows: [LimitKind, CardStats["fiveHour"]][] = [["five_hour", patch.fiveHour], ["seven_day", patch.sevenDay]];
  const out: LimitSample[] = [];
  for (const [kind, w] of windows) {
    if (!w) continue;
    const prev = last.get(key(backend, kind));
    if (prev && prev.used === w.used && prev.resetsAt === w.resetsAt) continue;
    out.push({ at: now, backend, kind, used: w.used, ...(w.resetsAt !== undefined && { resetsAt: w.resetsAt }) });
  }
  return out;
}

// Logs what a thread just learned about its CLI's limits (lib/runner-turn.ts). Never throws: the chart
// is a nicety, the turn isn't.
export function recordLimits(backend: Backend, patch: Partial<CardStats>, now = Date.now()) {
  const l = log();
  if (!l.last.size) for (const s of readSamples(now)) l.last.set(key(s.backend, s.kind), s);
  const fresh = changedSamples(backend, patch, l.last, now);
  if (!fresh.length) return;
  for (const s of fresh) l.last.set(key(s.backend, s.kind), s);
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.appendFileSync(LIMITS_FILE, fresh.map((s) => JSON.stringify(s)).join("\n") + "\n");
  } catch {}
}
