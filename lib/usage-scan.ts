import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { globalSingleton } from "./global-singleton";
import { DATA_DIR } from "./store";
import { readLine, type DayTokens, type LimitHit } from "./usage";
import { dayKey } from "./game";

// Token usage and limit hits from every Claude Code and puku-cli transcript, in Weft or the terminal,
// so the wefter card's chart has your history from day one. Transcripts run to gigabytes, so the scan
// runs in the background, reads each file only past where it stopped last time, and keeps what it
// found in ~/.weft/usage.json, by file: the byte offset read to, the last request counted, each day's
// tokens and the limit hits.

export const USAGE_FILE = path.join(DATA_DIR, "usage.json");

const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
export const TRANSCRIPT_DIRS = [path.join(CLAUDE_DIR, "projects"), path.join(os.homedir(), ".puku-cli", "projects")];

export interface FileUsage {
  offset: number;
  last?: string;
  days: Record<string, DayTokens>;
  hits: LimitHit[];
}

type Found = Record<string, FileUsage>;

interface State {
  found: Found | null;
  scan: Promise<void> | null;
  scannedAt: number;
}

const state = () => globalSingleton<State>("__weftUsage", () => ({ found: null, scan: null, scannedAt: 0 }));

// A scan at most this often; the chart doesn't need the last minute.
export const SCAN_EVERY = 60_000;
const CHUNK = 1 << 20;

function found(): Found {
  const s = state();
  if (!s.found) {
    try {
      s.found = JSON.parse(fs.readFileSync(USAGE_FILE, "utf8")) as Found;
    } catch {
      s.found = {};
    }
  }
  return s.found;
}

function save() {
  fs.mkdirSync(path.dirname(USAGE_FILE), { recursive: true });
  fs.writeFileSync(USAGE_FILE, JSON.stringify(found()));
}

export function transcripts(dirs = TRANSCRIPT_DIRS): string[] {
  return dirs.flatMap((dir) => {
    let projects: string[] = [];
    try {
      projects = fs.readdirSync(dir);
    } catch {
      return [];
    }
    return projects.flatMap((project) => {
      try {
        return fs.readdirSync(path.join(dir, project)).filter((f) => f.endsWith(".jsonl")).map((f) => path.join(dir, project, f));
      } catch {
        return [];
      }
    });
  });
}

// Adds one line's tokens or hit to a file's entry; a request seen on the line before is counted once.
export function addLine(entry: FileUsage, line: string) {
  const got = readLine(line);
  if (!got) return;
  if (got.type === "hit") {
    entry.hits.push(got.hit);
    return;
  }
  if (got.key === entry.last) return;
  entry.last = got.key;
  const day = dayKey(got.at);
  const [input, output] = entry.days[day] ?? [0, 0];
  entry.days[day] = [input + got.input, output + got.output];
}

// Reads a transcript from where the last scan stopped to its last full line.
async function readFrom(file: string, entry: FileUsage, size: number) {
  const handle = await fs.promises.open(file, "r");
  try {
    let rest = Buffer.alloc(0);
    let pos = entry.offset;
    while (pos < size) {
      const buf = Buffer.alloc(Math.min(CHUNK, size - pos));
      const { bytesRead } = await handle.read(buf, 0, buf.length, pos);
      if (!bytesRead) break;
      pos += bytesRead;
      const data = Buffer.concat([rest, buf.subarray(0, bytesRead)]);
      const end = data.lastIndexOf(0x0a);
      if (end < 0) {
        rest = data;
        continue;
      }
      for (const line of data.subarray(0, end).toString("utf8").split("\n")) addLine(entry, line);
      rest = data.subarray(end + 1);
      entry.offset = pos - rest.length;
    }
  } finally {
    await handle.close();
  }
}

async function scan(files: string[]) {
  const seen = found();
  let changed = 0;
  for (const file of files) {
    try {
      const { size } = await fs.promises.stat(file);
      let entry = seen[file];
      if (entry && entry.offset === size) continue;
      // Shorter than what was read: rewritten, so read it again.
      if (!entry || entry.offset > size) entry = seen[file] = { offset: 0, days: {}, hits: [] };
      await readFrom(file, entry, size);
      // The first scan reads gigabytes: keep what it has so far every few hundred files.
      if (++changed % 200 === 0) save();
    } catch {
      // Gone or unreadable: what it had stays counted.
    }
  }
  if (changed) save();
}

// Reads new transcript lines, one scan at a time and at most once a minute; callers share the one running.
export function scanUsage(now = Date.now(), files?: () => string[]): Promise<void> {
  const s = state();
  if (!s.scan && now - s.scannedAt < SCAN_EVERY) return Promise.resolve();
  s.scan ??= scan((files ?? transcripts)()).finally(() => {
    s.scan = null;
    s.scannedAt = Date.now();
  });
  return s.scan;
}

// Every day's tokens and every hit the transcripts showed, as the last scan left them.
export function transcriptUsage(): { tokens: Map<string, DayTokens>; hits: LimitHit[] } {
  const tokens = new Map<string, DayTokens>();
  const hits: LimitHit[] = [];
  for (const entry of Object.values(found())) {
    for (const [day, [input, output]] of Object.entries(entry.days)) {
      const [i, o] = tokens.get(day) ?? [0, 0];
      tokens.set(day, [i + input, o + output]);
    }
    hits.push(...entry.hits);
  }
  return { tokens, hits };
}
