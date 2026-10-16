// The web board's pure logic: how the org's cloud_cards become the five columns on weft.zip's
// /[orgSlug]/board page, how a Realtime change updates that list in place, and how a thread item
// (with its blob refs and cut tool results) is massaged for rendering.
//
// The page is a read-only mirror of the desktop outbox — no writes ever go back. Everything here
// stays pure: callers pass in the rows they read and the diffs Realtime sends, and get back fresh
// data shapes for the board to render.
import { BLOB_REF_PREFIX, isBlobRef, THREAD_PAGE_SIZE, type CloudCardRow, type CloudThreadItemRow } from "./cloud-sync-types";
import type { Card, ThreadItem } from "./types";

// ─── Cards → the board ───────────────────────────────────────────────────────

// The cards the board draws: every synced card that isn't deleted, and not the copilot (it has its
// own lane on the desktop and never shows as a card). What to show of them (project, filter, sort,
// columns) is the desktop's own lib/board-view.ts, so the two boards read the same.
export function webCards(rows: CloudCardRow[]): Card[] {
  const cards: Card[] = [];
  for (const row of rows) {
    if (row.deleted || row.card.role === "copilot") continue;
    cards.push(row.card);
  }
  return cards;
}

// The header's "N running · M need you". Archived cards are out of sight, so they don't count.
export function boardCounts(cards: Card[]): { running: number; waiting: number } {
  const open = cards.filter((c) => !c.archived);
  return {
    running: open.filter((c) => c.column === "running").length,
    waiting: open.filter((c) => c.column === "needs_you").length,
  };
}

function compareThreadItems(a: ThreadItem, b: ThreadItem): number {
  // Cast through unknown: an old row from before `at` was always set may be missing the field
  // (the panel needs to render anyway, with the row at the bottom of the window).
  const av = ((a as { at?: number }).at) || 0;
  const bv = ((b as { at?: number }).at) || 0;
  if (av < bv) return 1;
  if (av > bv) return -1;
  return 0;
}

// A tiny public surface so the comparator can be unit-tested without forcing v8 to inline it
// inside a sort and lose branch coverage. Production code never reaches in here.
export const _internals = { compareThreadItems };

// ─── Realtime → card list ────────────────────────────────────────────────────

// The shapes Supabase delivers on the postgres_changes channel for cloud_cards.
export type CloudCardChange =
  | { eventType: "INSERT"; new: CloudCardRow; old: Partial<CloudCardRow> | null }
  | { eventType: "UPDATE"; new: CloudCardRow; old: Partial<CloudCardRow> | null }
  | { eventType: "DELETE"; old: Partial<CloudCardRow> | null };

// Apply a single Realtime change to the card list. Inserts and updates with `deleted: true` drop
// the card; updates without that flag replace it in place; deletes drop it too.
export function applyCardChange(cards: CloudCardRow[], change: CloudCardChange): CloudCardRow[] {
  const next = cards.slice();
  if (change.eventType === "DELETE") {
    const id = change.old?.card_id;
    if (!id) return cards;
    const idx = next.findIndex((c) => c.card_id === id);
    return idx === -1 ? cards : next.filter((c) => c.card_id !== id);
  }
  const row = change.new;
  const idx = next.findIndex((c) => c.card_id === row.card_id);
  if (row.deleted) {
    return idx === -1 ? cards : next.filter((c) => c.card_id !== row.card_id);
  }
  if (idx === -1) return [...next, row];
  next[idx] = row;
  return next;
}

// ─── Thread items → renderable window ───────────────────────────────────────

// A cloud row's seq isn't part of the ThreadItem type (lib/types.ts), so the window stamps it on each item. That
// is how a Realtime UPDATE finds the slot it replaces, a DELETE the item it drops, and "Load older" its cursor.
export const SEQ_FIELD = "__seq" as const;
export const seqOf = (item: ThreadItem): number | undefined => (item as ThreadItem & { [SEQ_FIELD]?: number })[SEQ_FIELD];
const withSeq = (item: ThreadItem, seq: number): ThreadItem => Object.assign({}, item, { [SEQ_FIELD]: seq });

// The window's items the way a thread reads: oldest first, by their place in the thread.
export function chronological(items: ThreadItem[]): ThreadItem[] {
  return items.toSorted((a, b) => (seqOf(a) ?? 0) - (seqOf(b) ?? 0));
}

// A thread window the panel keeps: the items it knows about, ordered newest first, whether more
// older items are likely, and the set of blob refs the renderer will need to fetch.
export interface WebBoardThread {
  cardId: string;
  items: ThreadItem[];
  hasOlder: boolean;
  blobRefs: string[];
}

// Turn a page of cloud_thread_items rows (newest first) into a thread window. A full page probably
// has older items behind it, so "Load earlier" makes sense. A row whose item isn't an object is
// dropped so a partial event doesn't break the panel.
export function windowFromItems(cardId: string, rows: CloudThreadItemRow[]): WebBoardThread {
  const items: ThreadItem[] = [];
  const refs = new Set<string>();
  for (const row of rows) {
    if (row.card_id !== cardId) continue;
    if (typeof row.item !== "object" || !("kind" in row.item)) continue;
    items.push(withSeq(row.item, row.seq));
  }
  items.sort(compareThreadItems);
  collectBlobRefs(items, refs);
  return {
    cardId,
    items,
    hasOlder: rows.length >= THREAD_PAGE_SIZE,
    blobRefs: [...refs],
  };
}

// Apply a single Realtime item change to a window. New items are unshifted to the top; an update
// at the same timestamp replaces its slot; truncate drops items older (greater seq) than the cut.
export function applyItemChange(window: WebBoardThread, change: { eventType: "INSERT" | "UPDATE" | "DELETE"; new?: CloudThreadItemRow; old?: Partial<CloudThreadItemRow> }): WebBoardThread {
  if (change.eventType === "DELETE") {
    const id = change.old?.seq;
    const cardId = change.old?.card_id;
    if (typeof id !== "number" || cardId !== window.cardId) return window;
    return { ...window, items: window.items.filter((item) => seqOf(item) !== id) };
  }
  const row = change.new;
  if (!row || row.card_id !== window.cardId) return window;
  // A truncate (the desktop's rewind/↑) ships a DELETE for every seq at and after the cut. Each
  // DELETE above already trimmed its own item; what's left is the window with the items dropped.
  // The renderer also sees new items arriving after the cut as fresh INSERTs.
  const items = window.items.slice();
  const stamped = withSeq(row.item, row.seq);
  const idx = items.findIndex((it) => seqOf(it) === row.seq);
  if (idx === -1) items.unshift(stamped);
  else items[idx] = stamped;
  const refs = new Set<string>();
  collectBlobRefs(items, refs);
  return { ...window, items, blobRefs: [...refs] };
}

// A blob:sha256:<64-hex> token can appear in two places: as a string on its own (an `images`
// entry, the value of a jsonb field) or embedded inside a longer string (a markdown image
// target like `![shot](blob:sha256:…)`, an `attachment ref`). The regex matches the same shape
// `isBlobRef` checks for, so an extracted token is always a real BlobRef.
const BLOB_REF_RE = /blob:sha256:[0-9a-f]{64}/g;

// Walk a thread item tree and pull every blob:sha256:<hex> reference it contains. The result feeds
// the signed-URL batch so a long thread does one createSignedUrls call, not fifty.
export function collectBlobRefs(items: ThreadItem[], into: Set<string>): void {
  const visit = (value: unknown) => {
    if (typeof value === "string") {
      if (isBlobRef(value)) {
        into.add(value);
        return;
      }
      for (const match of value.matchAll(BLOB_REF_RE)) {
        const ref = match[0];
        if (ref) into.add(ref);
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const v of value) visit(v);
      return;
    }
    if (value && typeof value === "object") {
      for (const v of Object.values(value as Record<string, unknown>)) visit(v);
    }
  };
  for (const item of items) visit(item);
}

// Replace every blob:sha256:<hex> reference in a thread window's items with the matching signed
// URL. `map` is the ref→url table from createSignedUrls; refs without a match keep their blob:
// form so a missing one is visible (and the page can re-fetch). The window's other fields
// (cardId, hasOlder, blobRefs) pass through unchanged.
export function rewriteWindowBlobRefs(window: WebBoardThread, map: Record<string, string>): WebBoardThread {
  return { ...window, items: rewriteBlobRefs(window.items, map) };
}

// Replace every blob:sha256:<hex> reference in `items` with the matching signed URL. `map` is the
// ref→url table from createSignedUrls; refs without a match keep their blob: form so a missing
// one is visible (and the page can re-fetch).
export function rewriteBlobRefs(items: ThreadItem[], map: Record<string, string>): ThreadItem[] {
  const replace = (value: unknown): unknown => {
    if (typeof value === "string") {
      if (isBlobRef(value)) return map[value] ?? value;
      return value.replace(BLOB_REF_RE, (ref) => map[ref] ?? ref);
    }
    if (Array.isArray(value)) return value.map(replace);
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = replace(v);
      return out;
    }
    return value;
  };
  return items.map((item) => replace(item) as ThreadItem);
}

// ─── Storage → signed URLs ───────────────────────────────────────────────────

// The blob path on storage for an org + ref. Centred here so the writer and the reader can't drift.
export function blobPath(orgId: string, ref: string): string {
  // isBlobRef guarantees the prefix; the trailing 64-hex is what the bucket expects.
  return `${orgId}/${ref.slice(BLOB_REF_PREFIX.length)}`;
}

// Bucket refs into chunks no larger than `batchSize` so a thread with many blobs doesn't hit a
// single oversized request. The storage API caps each call; keeping the batch small also keeps
// the renderer from doing dozens of fetches.
export function batchBlobRefs(refs: readonly string[], batchSize = 50): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < refs.length; i += batchSize) out.push(refs.slice(i, i + batchSize));
  return out;
}

// Build the final ref→url table from createSignedUrls' `{ path, signedUrl }[]` response, with
// blob refs as keys. Unmapped refs (a 404 on storage) are skipped so the caller can show the
// raw ref and re-fetch.
export function buildBlobUrlMap(paths: { path: string; signedUrl: string | null }[], refs: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of paths) {
    if (!entry.signedUrl) continue;
    const ref = refFromPath(entry.path);
    if (refs.includes(ref) && isBlobRef(ref)) out[ref] = entry.signedUrl;
  }
  // references that didn't show up (a real path can be missing from the storage response); leave
  // them unmapped so the renderer's ref-keyed lookup degrades gracefully.
  return out;
}

// Reconstruct a blob:sha256:<hex> ref from a storage path. The path's last segment is the sha;
// an empty path (a folder that no longer has any blobs) is skipped by the caller's `isBlobRef`
// check rather than by the parser.
function refFromPath(path: string): string {
  return `${BLOB_REF_PREFIX}${path.split("/").pop()}`;
}