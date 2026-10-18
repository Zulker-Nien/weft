// lib/web-board.ts: the web board's pure logic — how cards group into columns, how Realtime
// changes update the list, how a thread's items sort chronologically, and how blob refs are
// collected and rewritten to signed URLs. We mock nothing; this file is pure and the tests stay
// small.
import { beforeEach, describe, expect, it } from "vitest";
import { BLOB_REF_PREFIX, type CloudCardRow } from "./cloud-sync-types";
import {
  applyCardChange,
  SEQ_FIELD,
  batchBlobRefs,
  blobPath,
  buildBlobUrlMap,
  collectBlobRefs,
  boardCounts,
  chronological,
  webCards,
  rewriteBlobRefs,
} from "./web-board";
import type { Card, ThreadItem } from "./types";

const ORG = "00000000-0000-0000-0000-000000000001";
const SHA = "a".repeat(64);
const REF = `${BLOB_REF_PREFIX}${SHA}` as const;

function makeCard(over: Partial<Card> = {}): Card {
  return {
    id: "c1",
    title: "Hello",
    prompt: "Hi",
    cwd: "/u/me/projects/app",
    backend: "claude",
    permissionMode: "auto",
    column: "review",
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

function makeRow(over: Partial<CloudCardRow> = {}): CloudCardRow {
  return {
    org_id: ORG,
    card_id: "c1",
    owner_device: "dev-laptop",
    folder: "/u/me/projects/app",
    card: makeCard(),
    deleted: false,
    updated_at: "2026-10-15T10:00:00.000Z",
    ...over,
  };
}

beforeEach(() => {
  // sanity: the BLOB_REF_PREFIX check below is what isBlobRef matches; assert it stays that way.
  expect(REF.startsWith(BLOB_REF_PREFIX)).toBe(true);
});

describe("webCards", () => {
  it("returns each live card's own Card, in the order the rows came", () => {
    const rows = [
      makeRow({ card_id: "a", card: makeCard({ id: "a" }) }),
      makeRow({ card_id: "b", card: makeCard({ id: "b" }) }),
    ];
    expect(webCards(rows).map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("skips deleted rows and the copilot", () => {
    const rows = [
      makeRow({ card_id: "x", deleted: true, card: makeCard({ id: "x" }) }),
      makeRow({ card_id: "cp", card: makeCard({ id: "cp", role: "copilot" }) }),
      makeRow({ card_id: "z", card: makeCard({ id: "z" }) }),
    ];
    expect(webCards(rows).map((c) => c.id)).toEqual(["z"]);
  });
});

describe("boardCounts", () => {
  it("counts running and needs-you cards, leaving archived ones out", () => {
    const cards = [
      makeCard({ id: "1", column: "running" }),
      makeCard({ id: "2", column: "running", archived: true }),
      makeCard({ id: "3", column: "needs_you" }),
      makeCard({ id: "4", column: "needs_you" }),
      makeCard({ id: "5", column: "done" }),
    ];
    expect(boardCounts(cards)).toEqual({ running: 1, waiting: 2 });
    expect(boardCounts([])).toEqual({ running: 0, waiting: 0 });
  });
});

describe("applyCardChange", () => {
  const a = makeRow({ card_id: "a", updated_at: "2026-10-15T10:00:00.000Z" });
  const b = makeRow({ card_id: "b", updated_at: "2026-10-15T10:01:00.000Z" });

  it("INSERTs a new card", () => {
    const c = makeRow({ card_id: "c" });
    const next = applyCardChange([a, b], { eventType: "INSERT", new: c, old: null });
    expect(next.map((r) => r.card_id)).toEqual(["a", "b", "c"]);
  });

  it("UPDATEs an existing card in place", () => {
    const updated = makeRow({ card_id: "a", card: makeCard({ id: "a", title: "Renamed" }) });
    const next = applyCardChange([a, b], { eventType: "UPDATE", new: updated, old: { card_id: "a" } });
    expect(next).toHaveLength(2);
    expect(next[0]?.card.title).toBe("Renamed");
  });

  it("drops a card when an UPDATE marks it deleted", () => {
    const tombstone = makeRow({ card_id: "a", deleted: true });
    const next = applyCardChange([a, b], { eventType: "UPDATE", new: tombstone, old: { card_id: "a" } });
    expect(next.map((r) => r.card_id)).toEqual(["b"]);
  });

  it("leaves the list alone when an UPDATE for an unknown card marks it deleted", () => {
    const tombstone = makeRow({ card_id: "ghost", deleted: true });
    const next = applyCardChange([a, b], { eventType: "UPDATE", new: tombstone, old: { card_id: "ghost" } });
    expect(next).toEqual([a, b]);
  });

  it("DELETEs a card by old id", () => {
    const next = applyCardChange([a, b], { eventType: "DELETE", old: { card_id: "a" } });
    expect(next.map((r) => r.card_id)).toEqual(["b"]);
  });

  it("ignores a DELETE for a card it doesn't know about", () => {
    const next = applyCardChange([a, b], { eventType: "DELETE", old: { card_id: "ghost" } });
    expect(next).toHaveLength(2);
  });

  it("ignores a DELETE with no card_id", () => {
    expect(applyCardChange([a], { eventType: "DELETE", old: null })).toEqual([a]);
  });
});

describe("chronological", () => {
  it("puts the items oldest first by their seq carrier, leaving the input alone", () => {
    const stamp = (item: ThreadItem, seq: number): ThreadItem =>
      Object.assign({}, item, { [SEQ_FIELD]: seq });
    const items = [
      stamp({ kind: "user", text: "late", at: 2 }, 7),
      stamp({ kind: "user", text: "early", at: 1 }, 3),
    ];
    expect(items.map((i) => (i as { text: string }).text)).toEqual(["late", "early"]);
    expect(chronological(items).map((i) => (i as { text: string }).text)).toEqual(["early", "late"]);
    // An item with no seq (not from a row) sorts first.
    expect(chronological([{ kind: "user", text: "n" } as ThreadItem])).toHaveLength(1);
  });
});

describe("collectBlobRefs", () => {
  it("walks strings, arrays, and nested objects", () => {
    const refs = new Set<string>();
    const OTHER = `${BLOB_REF_PREFIX}${"b".repeat(64)}`;
    collectBlobRefs(
      [
        { kind: "user", text: `see ![shot](${REF})`, at: 1 },
        { kind: "tool", id: "t1", name: "Bash", summary: "ls", at: 1, result: "ok", images: [OTHER] },
      ] as unknown as ThreadItem[],
      refs,
    );
    expect(refs.size).toBe(2);
    expect(refs.has(REF)).toBe(true);
    expect(refs.has(OTHER)).toBe(true);
  });
});

describe("rewriteBlobRefs", () => {
  it("substitutes refs in strings, arrays, and nested objects; leaves unmapped refs alone", () => {
    const OTHER = `${BLOB_REF_PREFIX}${"b".repeat(64)}`;
    const items: ThreadItem[] = [
      { kind: "user", text: `![shot](${REF})`, at: 1 },
      { kind: "tool", id: "t1", name: "Bash", summary: "ls", at: 1, result: "ok", images: [REF, "https://example.com/x.png"] },
      { kind: "assistant", text: `unmapped ${OTHER}`, at: 1 },
    ];
    const out = rewriteBlobRefs(items, { [REF]: "https://signed/x" });
    const user = out[0] as Extract<ThreadItem, { kind: "user" }>;
    const tool = out[1] as Extract<ThreadItem, { kind: "tool" }>;
    const assistant = out[2] as Extract<ThreadItem, { kind: "assistant" }>;
    expect(user.text).toBe("![shot](https://signed/x)");
    const toolImages = tool.images ?? [];
    expect(toolImages[0]).toBe("https://signed/x");
    expect(toolImages[1]).toBe("https://example.com/x.png");
    expect(assistant.text).toContain(OTHER);
  });

  it("leaves a bare ref alone when the map doesn't have it", () => {
    const items: ThreadItem[] = [{ kind: "tool", id: "t", name: "Bash", summary: "x", at: 1, result: "ok", images: [REF] }];
    const out = rewriteBlobRefs(items, {});
    const tool = out[0] as Extract<ThreadItem, { kind: "tool" }>;
    const toolImages = tool.images ?? [];
    expect(toolImages[0]).toBe(REF);
  });
});

describe("blobPath / batchBlobRefs / buildBlobUrlMap", () => {
  it("builds the right storage path", () => {
    expect(blobPath(ORG, REF)).toBe(`${ORG}/${SHA}`);
  });

  it("batches refs into chunks of the requested size", () => {
    const refs = ["a", "b", "c", "d", "e"];
    expect(batchBlobRefs(refs, 2)).toEqual([["a", "b"], ["c", "d"], ["e"]]);
    expect(batchBlobRefs([], 2)).toEqual([]);
  });

  it("builds a ref→url table from the signed-URL response", () => {
    const refs = [REF];
    const map = buildBlobUrlMap([{ path: `${ORG}/${SHA}`, signedUrl: "https://signed" }], refs);
    expect(map[REF]).toBe("https://signed");
  });

  it("skips a null signed URL", () => {
    const refs = [REF];
    const map = buildBlobUrlMap([{ path: `${ORG}/${SHA}`, signedUrl: null }], refs);
    expect(map[REF]).toBeUndefined();
  });

  it("skips a ref that wasn't in the requested batch", () => {
    const refs: string[] = [];
    const map = buildBlobUrlMap([{ path: `${ORG}/${SHA}`, signedUrl: "https://signed" }], refs);
    expect(map).toEqual({});
  });

  it("skips a path without a final segment", () => {
    const refs = [REF];
    // Two paths: a normal one and an empty one (split("/").pop() returns "" — not a valid ref).
    const map = buildBlobUrlMap(
      [
        { path: `${ORG}/${SHA}`, signedUrl: "https://signed" },
        { path: "", signedUrl: "https://ignored" },
      ],
      refs,
    );
    expect(map[REF]).toBe("https://signed");
  });
});