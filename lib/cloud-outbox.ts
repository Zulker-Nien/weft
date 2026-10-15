// The outbox: bus events become OutboxEntry lines appended to a jsonl file, the flusher (lib/cloud-sync.ts)
// compacts and uploads them, and acknowledges (drops) what it has shipped. The file is the source of truth so
// pending work survives a crash; the in-process state stays tiny (the file is read on every call, not cached).
import fs from "node:fs";
import path from "node:path";
import type { OutboxEntry } from "./cloud-sync-types";
import { DATA_DIR } from "./store";

export const OUTBOX_FILE = path.join(DATA_DIR, "sync-outbox.jsonl");

// Reads every well-formed line, in order. A partial last line (a crash mid-write) or a non-object line is
// skipped so a single bad write doesn't wedge the flusher.
export function readOutbox(): OutboxEntry[] {
  if (!fs.existsSync(OUTBOX_FILE)) return [];
  const text = fs.readFileSync(OUTBOX_FILE, "utf8");
  if (!text) return [];
  const out: OutboxEntry[] = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (parsed && typeof parsed === "object" && "op" in parsed) out.push(parsed as OutboxEntry);
    } catch {
      // Skip the broken line; the next read starts past it.
    }
  }
  return out;
}

// One appendFileSync with a single "\n" join, so the file always ends with a newline. Atomic enough for a jsonl:
// a crash mid-write leaves a partial line that readOutbox skips.
export function appendOutbox(entries: OutboxEntry[]): void {
  if (!entries.length) return;
  fs.mkdirSync(path.dirname(OUTBOX_FILE), { recursive: true });
  fs.appendFileSync(OUTBOX_FILE, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
}

// Collapses dupes before a flush: for each card, keep the latest card / card_deleted; for items, dedupe by
// (cardId, seq) and keep the latest at; apply truncate by dropping items with seq >= the truncate's seq. The
// order stays as "at ascending" so a flush that breaks between batches leaves a coherent tail.
export function compactOutbox(entries: OutboxEntry[]): OutboxEntry[] {
  if (!entries.length) return [];
  const sorted = [...entries].sort((a, b) => a.at - b.at);
  const { latestMeta, truncateSeq, itemsByCard } = indexEntries(sorted);
  const out: OutboxEntry[] = [];
  for (const entry of sorted) {
    if (shouldKeep(entry, latestMeta, truncateSeq, itemsByCard)) out.push(entry);
  }
  return out;
}

interface CompactIndex {
  latestMeta: Map<string, OutboxEntry>;
  truncateSeq: Map<string, number>;
  itemsByCard: Map<string, Map<number, OutboxEntry>>;
}

function indexEntries(sorted: OutboxEntry[]): CompactIndex {
  const latestMeta = new Map<string, OutboxEntry>();
  const truncateSeq = new Map<string, number>();
  for (const entry of sorted) {
    if (entry.op === "card" || entry.op === "card_deleted") latestMeta.set(entry.cardId, entry);
    else if (entry.op === "truncate") recordTruncate(truncateSeq, entry);
  }
  const itemsByCard = new Map<string, Map<number, OutboxEntry>>();
  for (const entry of sorted) {
    if (entry.op !== "item") continue;
    const cut = truncateSeq.get(entry.cardId);
    if (cut !== undefined && entry.seq >= cut) continue;
    recordItem(itemsByCard, entry);
  }
  return { latestMeta, truncateSeq, itemsByCard };
}

function recordTruncate(truncateSeq: Map<string, number>, entry: OutboxEntry & { op: "truncate" }) {
  const cur = truncateSeq.get(entry.cardId);
  truncateSeq.set(entry.cardId, cur === undefined ? entry.seq : Math.min(cur, entry.seq));
}

function recordItem(itemsByCard: Map<string, Map<number, OutboxEntry>>, entry: OutboxEntry & { op: "item" }) {
  let perSeq = itemsByCard.get(entry.cardId);
  if (!perSeq) {
    perSeq = new Map();
    itemsByCard.set(entry.cardId, perSeq);
  }
  const cur = perSeq.get(entry.seq);
  if (!cur || entry.at >= cur.at) perSeq.set(entry.seq, entry);
}

function shouldKeep(
  entry: OutboxEntry,
  latestMeta: Map<string, OutboxEntry>,
  truncateSeq: Map<string, number>,
  itemsByCard: Map<string, Map<number, OutboxEntry>>,
): boolean {
  if (entry.op === "item") return itemsByCard.get(entry.cardId)?.get(entry.seq) === entry;
  if (entry.op === "truncate") return truncateSeq.get(entry.cardId) === entry.seq;
  return latestMeta.get(entry.cardId) === entry;
}

// Swaps the first `count` entries for `entries` (the flusher's compacted copy, or [] once they're uploaded) and
// keeps whatever was appended after them. By position, not by key: an entry appended mid-upload for the same
// card and seq is newer than what was sent, so it must stay. Appends and this rewrite are both synchronous in
// one process, so nothing lands between the read and the rename.
export function replaceOutboxHead(count: number, entries: OutboxEntry[]): void {
  const current = readOutbox();
  const kept = [...entries, ...current.slice(count)];
  fs.mkdirSync(path.dirname(OUTBOX_FILE), { recursive: true });
  const tmp = `${OUTBOX_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, kept.map((e) => JSON.stringify(e)).join("\n") + (kept.length ? "\n" : ""));
  fs.renameSync(tmp, OUTBOX_FILE);
}
