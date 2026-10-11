import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { sessionFiles } from "./import";
import { DATA_DIR, listCards } from "./store";
import { typedPromptOf } from "./transcript";
import { COPILOT_ID } from "./types";

// Full-text search over what the user typed. The index covers every Claude Code session on this
// machine plus the threads Weft runs, but a search only returns prompts from cards on the board.
// Session files are append-only, so each is read from where the last pass stopped.

const DB_FILE = path.join(DATA_DIR, "search.db");
const THREADS_DIR = path.join(DATA_DIR, "threads");
const REFRESH_EVERY_MS = 60_000;
const READ_CHUNK = 8 * 1024 * 1024;
const MAX_PROMPT_CHARS = 8000;
const MAX_CARDS = 20;
const PER_CARD = 2;
// Marks the matched words in a snippet; the palette turns them into highlights.
export const MARK_START = "\u0001";
export const MARK_END = "\u0002";

export interface PromptHit {
  cardId: string;
  at: number;
  snippet: string;
}

export interface SearchResult {
  hits: PromptHit[];
  // True while the first pass over the sessions on disk is still running, so results may be partial.
  indexing: boolean;
}

interface Row {
  at: number;
  text: string;
}

const g = globalThis as unknown as {
  __weftSearchDb?: DatabaseSync;
  __weftSearchRefresh?: Promise<void>;
  __weftSearchTimer?: ReturnType<typeof setInterval>;
  __weftSearchReady?: boolean;
};

function open(): DatabaseSync {
  if (g.__weftSearchDb) return g.__weftSearchDb;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new DatabaseSync(DB_FILE);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS sources (path TEXT PRIMARY KEY, key TEXT NOT NULL, pos INTEGER NOT NULL, mtime REAL NOT NULL);
    CREATE TABLE IF NOT EXISTS prompts (id INTEGER PRIMARY KEY, key TEXT NOT NULL, at INTEGER NOT NULL, text TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS prompts_key ON prompts (key);
    CREATE VIRTUAL TABLE IF NOT EXISTS prompts_fts USING fts5(text, content='prompts', content_rowid='id', tokenize='porter unicode61');
    CREATE TRIGGER IF NOT EXISTS prompts_ai AFTER INSERT ON prompts BEGIN
      INSERT INTO prompts_fts (rowid, text) VALUES (new.id, new.text);
    END;
    CREATE TRIGGER IF NOT EXISTS prompts_ad AFTER DELETE ON prompts BEGIN
      INSERT INTO prompts_fts (prompts_fts, rowid, text) VALUES ('delete', old.id, old.text);
    END;
  `);
  g.__weftSearchDb = db;
  return db;
}

function store(db: DatabaseSync, file: string, key: string, pos: number, mtime: number, rows: Row[], reset: boolean) {
  db.exec("BEGIN");
  try {
    if (reset) db.prepare("DELETE FROM prompts WHERE key = ?").run(key);
    const insert = db.prepare("INSERT INTO prompts (key, at, text) VALUES (?, ?, ?)");
    for (const row of rows) insert.run(key, row.at, row.text);
    db.prepare("INSERT OR REPLACE INTO sources (path, key, pos, mtime) VALUES (?, ?, ?, ?)").run(file, key, pos, mtime);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

// Calls onLine for each whole line of the file from `from` to `size`; returns where the last whole line ended.
async function readLines(file: string, from: number, size: number, onLine: (line: string) => void): Promise<number> {
  const handle = await fs.promises.open(file, "r");
  try {
    const buf = Buffer.allocUnsafe(READ_CHUNK);
    let pos = from;
    let carry: Buffer = Buffer.alloc(0);
    while (pos < size) {
      const { bytesRead } = await handle.read(buf, 0, Math.min(READ_CHUNK, size - pos), pos);
      if (!bytesRead) break;
      pos += bytesRead;
      const data = carry.length ? Buffer.concat([carry, buf.subarray(0, bytesRead)]) : buf.subarray(0, bytesRead);
      let start = 0;
      for (let nl = data.indexOf(10, start); nl >= 0; nl = data.indexOf(10, start)) {
        onLine(data.toString("utf8", start, nl));
        start = nl + 1;
      }
      carry = Buffer.from(data.subarray(start));
    }
    return pos - carry.length;
  } finally {
    await handle.close();
  }
}

function clip(text: string) {
  return text.length > MAX_PROMPT_CHARS ? text.slice(0, MAX_PROMPT_CHARS) : text;
}

async function indexSession(db: DatabaseSync, sessionId: string, file: string) {
  const stat = await fs.promises.stat(file);
  const known = db.prepare("SELECT pos, mtime FROM sources WHERE path = ?").get(file) as { pos: number; mtime: number } | undefined;
  if (known && known.pos <= stat.size && known.mtime === stat.mtimeMs) return;
  const reset = !known || known.pos > stat.size;
  const rows: Row[] = [];
  const pos = await readLines(file, reset ? 0 : known.pos, stat.size, (line) => {
    if (!line.includes('"type":"user"')) return;
    try {
      const record = JSON.parse(line) as Record<string, unknown>;
      const text = typedPromptOf(record);
      if (text) rows.push({ at: Date.parse(String(record.timestamp)) || 0, text: clip(text) });
    } catch {
      // A line that isn't JSON isn't a prompt.
    }
  });
  store(db, file, `session:${sessionId}`, pos, stat.mtimeMs, rows, reset);
}

// A thread Weft runs keeps its prompts in ~/.weft/threads/<id>.json, rewritten whole on every change.
async function indexThread(db: DatabaseSync, cardId: string, file: string) {
  const stat = await fs.promises.stat(file);
  const known = db.prepare("SELECT mtime FROM sources WHERE path = ?").get(file) as { mtime: number } | undefined;
  if (known?.mtime === stat.mtimeMs) return;
  const rows: Row[] = [];
  try {
    const items = JSON.parse(await fs.promises.readFile(file, "utf8")) as { kind?: string; text?: string; at?: number }[];
    for (const item of items) if (item.kind === "user" && item.text?.trim()) rows.push({ at: item.at ?? 0, text: clip(item.text) });
  } catch {
    return;
  }
  store(db, file, `card:${cardId}`, 0, stat.mtimeMs, rows, true);
}

async function refresh() {
  const db = open();
  for (const [sessionId, file] of sessionFiles()) {
    await indexSession(db, sessionId, file).catch((err: unknown) => console.error(`Couldn't index ${file}:`, err));
    // Let requests through between files; the first pass can read gigabytes.
    await new Promise((resolve) => setImmediate(resolve));
  }
  let names: string[] = [];
  try {
    names = fs.readdirSync(THREADS_DIR).filter((n) => n.endsWith(".json"));
  } catch {
    // No threads yet.
  }
  for (const name of names) {
    await indexThread(db, name.slice(0, -5), path.join(THREADS_DIR, name)).catch((err: unknown) => console.error(`Couldn't index ${name}:`, err));
  }
  g.__weftSearchReady = true;
}

function refreshIndex(): Promise<void> {
  g.__weftSearchRefresh ??= refresh().finally(() => {
    g.__weftSearchRefresh = undefined;
  });
  return g.__weftSearchRefresh;
}

// Indexes now and then every minute, once per server process.
export function startSearchIndex() {
  if (g.__weftSearchTimer) return;
  g.__weftSearchTimer = setInterval(() => void refreshIndex().catch(() => {}), REFRESH_EVERY_MS);
  void refreshIndex().catch((err: unknown) => console.error("Search indexing failed:", err));
}

// Every word must match, and the last one as a prefix so results appear while typing.
function matchQuery(query: string): string | null {
  const words = query.match(/[\p{L}\p{N}]+/gu);
  if (!words) return null;
  return words.map((w, i) => `"${w}"${i === words.length - 1 ? "*" : ""}`).join(" AND ");
}

function normalize(text: string) {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

export function searchPrompts(query: string): SearchResult {
  startSearchIndex();
  const indexing = !g.__weftSearchReady;
  const match = matchQuery(query);
  if (!match) return { hits: [], indexing };

  // Index keys → the card they belong to. A card run in Weft can be in the index under both its
  // session and its own thread file.
  const owner = new Map<string, string>();
  for (const card of listCards()) {
    if (card.id === COPILOT_ID || card.role === "copilot") continue;
    owner.set(`card:${card.id}`, card.id);
    if (card.sessionId) owner.set(`session:${card.sessionId}`, card.id);
  }

  const rows = open()
    .prepare(
      `SELECT p.key AS key, p.at AS at, p.text AS text, snippet(prompts_fts, 0, ?, ?, '…', 18) AS snippet
       FROM prompts_fts JOIN prompts p ON p.id = prompts_fts.rowid
       WHERE prompts_fts MATCH ? AND p.key IN (SELECT value FROM json_each(?))
       ORDER BY bm25(prompts_fts) LIMIT 200`,
    )
    .all(MARK_START, MARK_END, match, JSON.stringify([...owner.keys()])) as { key: string; at: number; text: string; snippet: string }[];

  const perCard = new Map<string, PromptHit[]>();
  const seen = new Set<string>();
  for (const row of rows) {
    const cardId = owner.get(row.key);
    if (!cardId) continue;
    const dupe = `${cardId}\n${normalize(row.text)}`;
    if (seen.has(dupe)) continue;
    seen.add(dupe);
    const hits = perCard.get(cardId) ?? [];
    if (hits.length < PER_CARD) perCard.set(cardId, [...hits, { cardId, at: row.at, snippet: row.snippet }]);
  }
  return { hits: [...perCard.values()].slice(0, MAX_CARDS).flat(), indexing };
}
