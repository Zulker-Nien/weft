// The web board's pure logic: how the org's cloud_cards become the five columns on weft.zip's
// /[orgSlug]/board page, how a Realtime change updates that list in place, and how a thread's
// items have their blob refs collected and rewritten to signed URLs.
//
// The page is a read-only mirror of the desktop outbox — no writes ever go back. Everything here
// stays pure: callers pass in the rows they read and the diffs Realtime sends, and get back fresh
// data shapes for the board to render.
import { BLOB_REF_PREFIX, isBlobRef, type CloudCardRow } from "./cloud-sync-types";
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

// ─── Thread items → chronological order ────────────────────────────────────

// A cloud row's seq isn't part of the ThreadItem type (lib/types.ts); the page transport stamps it
// on each item with this carrier field so the panel can sort chronologically and find a slot by
// seq. SharedCard (components/share-view/SharedCard.tsx) uses the same field shape.
export const SEQ_FIELD = "__seq" as const;
export const seqOf = (item: ThreadItem): number | undefined => (item as ThreadItem & { [SEQ_FIELD]?: number })[SEQ_FIELD];

// Items in the order a thread reads: oldest first, by their place in the thread (the seq carrier
// the page transport stamps on each row). Items without a seq sort to the front so an item that
// lost its carrier (e.g. an old malformed row) still appears.
export function chronological(items: ThreadItem[]): ThreadItem[] {
  return items.toSorted((a, b) => (seqOf(a) ?? 0) - (seqOf(b) ?? 0));
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