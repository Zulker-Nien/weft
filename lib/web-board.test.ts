// lib/web-board.ts: the web board's pure logic — how cards group into columns, how Realtime
// changes update the list, how a thread window is built, and how blob refs are rewritten to
// signed URLs. We mock nothing; this file is pure and the tests stay small.
import { beforeEach, describe, expect, it } from "vitest";
import { BLOB_REF_PREFIX, type CloudCardRow, type CloudThreadItemRow } from "./cloud-sync-types";
import {
  applyCardChange,
  applyItemChange,
  batchBlobRefs,
  blobPath,
  buildBlobUrlMap,
  collectBlobRefs,
  columnFor,
  folderName,
  groupCardsByColumn,
  toolOutputSummary,
  windowFromItems,
  rewriteBlobRefs,
  rewriteWindowBlobRefs,
  type WebBoardCard,
  _internals,
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

describe("_internals", () => {
  it("compareWebCards returns the right sign for every branch", () => {
    const a: WebBoardCard = { id: "a", card: makeCard(), folder: "", ownerDevice: "", updatedAt: "2026-10-15T10:00:00.000Z" };
    const b: WebBoardCard = { id: "b", card: makeCard(), folder: "", ownerDevice: "", updatedAt: "2026-10-15T11:00:00.000Z" };
    const same: WebBoardCard = { id: "a", card: makeCard(), folder: "", ownerDevice: "", updatedAt: "2026-10-15T10:00:00.000Z" };
    expect(_internals.compareWebCards(a, b)).toBe(1);
    expect(_internals.compareWebCards(b, a)).toBe(-1);
    expect(_internals.compareWebCards(a, same)).toBe(0);
  });

  it("compareThreadItems fills in the `?? 0` and returns the right sign for every branch", () => {
    const a: ThreadItem = { kind: "user", text: "a", at: 5 };
    const b: ThreadItem = { kind: "user", text: "b", at: 10 };
    // A ThreadItem without an `at` (e.g. an old malformed row) gets a default of 0.
    const stripped = { kind: "user" } as unknown as ThreadItem;
    expect(_internals.compareThreadItems(a, b)).toBe(1);
    expect(_internals.compareThreadItems(b, a)).toBe(-1);
    expect(_internals.compareThreadItems(a, { ...a })).toBe(0);
    expect(_internals.compareThreadItems(stripped, stripped)).toBe(0);
    // a (5) > stripped.at (0)
    expect(_internals.compareThreadItems(a, stripped)).toBe(-1);
    // stripped.at (0) < b (10)
    expect(_internals.compareThreadItems(stripped, b)).toBe(1);
  });
});

describe("groupCardsByColumn", () => {
  it("places each card in its own column and sorts newest first by updated_at", () => {
    const rows: CloudCardRow[] = [
      makeRow({ card_id: "a", card: makeCard({ id: "a", column: "running" }), updated_at: "2026-10-15T10:00:00.000Z" }),
      makeRow({ card_id: "b", card: makeCard({ id: "b", column: "running" }), updated_at: "2026-10-15T11:00:00.000Z" }),
      makeRow({ card_id: "c", card: makeCard({ id: "c", column: "review" }), updated_at: "2026-10-15T09:00:00.000Z" }),
    ];
    const cols = groupCardsByColumn(rows);
    expect(cols.map((c) => c.id)).toEqual(["backlog", "running", "needs_you", "review", "done"]);
    const running = cols.find((c) => c.id === "running")!;
    expect(running.cards.map((c) => c.id)).toEqual(["b", "a"]);
    expect(running.cards[0]?.folder).toBe("/u/me/projects/app");
    expect(running.cards[0]?.ownerDevice).toBe("dev-laptop");
  });

  it("keeps two cards in the same order when their updated_at is the same", () => {
    const rows: CloudCardRow[] = [
      makeRow({ card_id: "a", card: makeCard({ id: "a", column: "running" }), updated_at: "2026-10-15T10:00:00.000Z" }),
      makeRow({ card_id: "b", card: makeCard({ id: "b", column: "running" }), updated_at: "2026-10-15T10:00:00.000Z" }),
      makeRow({ card_id: "c", card: makeCard({ id: "c", column: "running" }), updated_at: "2026-10-15T11:00:00.000Z" }),
    ];
    const cols = groupCardsByColumn(rows);
    const running = cols.find((c) => c.id === "running")!;
    expect(running.cards.map((c) => c.id)).toEqual(["c", "a", "b"]);
  });

  it("skips deleted cards and unknown columns", () => {
    const cols = groupCardsByColumn([
      makeRow({ card_id: "x", deleted: true }),
      makeRow({ card_id: "y", card: makeCard({ id: "y", column: "nope" as unknown as Card["column"] }) }),
      makeRow({ card_id: "z", card: makeCard({ id: "z", column: "done" }) }),
    ]);
    const done = cols.find((c) => c.id === "done")!;
    expect(done.cards).toHaveLength(1);
    expect(done.cards[0]?.id).toBe("z");
  });
});

describe("columnFor", () => {
  it("returns the same string for every known column", () => {
    for (const id of ["backlog", "running", "needs_you", "review", "done"]) {
      expect(columnFor(id)).toBe(id);
    }
  });
  it("returns null for anything else", () => {
    expect(columnFor(undefined)).toBeNull();
    expect(columnFor("archive")).toBeNull();
    expect(columnFor(42 as unknown as string)).toBeNull();
  });
});

describe("folderName", () => {
  it("returns the last segment of a unix or windows path", () => {
    expect(folderName("/Users/me/projects/app")).toBe("app");
    expect(folderName("C:\\dev\\app")).toBe("app");
    expect(folderName("just-a-name")).toBe("just-a-name");
  });
  it("falls back to the original when the path has no separators", () => {
    expect(folderName("")).toBe("");
    expect(folderName("/")).toBe("");
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

describe("windowFromItems", () => {
  const userMsg: ThreadItem = { kind: "user", text: "Hello", at: 1000 };
  const assistantMsg: ThreadItem = { kind: "assistant", text: "Hi back", at: 2000 };
  const toolMsg: ThreadItem = { kind: "tool", id: "t1", name: "Bash", summary: "ls", at: 3000, result: "ok", images: [REF] };

  it("orders items newest first and collects every blob ref", () => {
    const rows: CloudThreadItemRow[] = [
      { org_id: ORG, card_id: "c1", seq: 0, kind: "user", item: userMsg, at: "2026-10-15T10:00:00.000Z" },
      { org_id: ORG, card_id: "c1", seq: 1, kind: "assistant", item: assistantMsg, at: "2026-10-15T10:00:01.000Z" },
      { org_id: ORG, card_id: "c1", seq: 2, kind: "tool", item: toolMsg, at: "2026-10-15T10:00:02.000Z" },
    ];
    const w = windowFromItems("c1", rows);
    expect(w.items.map((i) => i.kind)).toEqual(["tool", "assistant", "user"]);
    expect(w.blobRefs).toEqual([REF]);
    expect(w.hasOlder).toBe(false);
  });

  it("keeps stable order for two items at the same timestamp", () => {
    // Three items, two at the same time: forces the comparator's `=== 0` branch.
    const rows: CloudThreadItemRow[] = [
      { org_id: ORG, card_id: "c1", seq: 0, kind: "user", item: { kind: "user", text: "a", at: 5 }, at: "2026-10-15T10:00:00.000Z" },
      { org_id: ORG, card_id: "c1", seq: 1, kind: "user", item: { kind: "user", text: "b", at: 10 }, at: "2026-10-15T10:00:01.000Z" },
      { org_id: ORG, card_id: "c1", seq: 2, kind: "user", item: { kind: "user", text: "c", at: 5 }, at: "2026-10-15T10:00:02.000Z" },
    ];
    const w = windowFromItems("c1", rows);
    expect(w.items.map((i) => (i as Extract<ThreadItem, { kind: "user" }>).text)).toEqual(["b", "a", "c"]);
  });

  it("sets hasOlder when a full page older than seq was loaded", () => {
    const small: CloudThreadItemRow[] = [
      { org_id: ORG, card_id: "c1", seq: 0, kind: "user", item: userMsg, at: "2026-10-15T10:00:00.000Z" },
    ];
    const full: CloudThreadItemRow[] = [];
    for (let i = 0; i < 50; i++) {
      full.push({ org_id: ORG, card_id: "c1", seq: i, kind: "user", item: userMsg, at: "2026-10-15T10:00:00.000Z" });
    }
    // A partial page (1 row) might be the end of the thread — hasOlder stays false.
    expect(windowFromItems("c1", small, 5).hasOlder).toBe(false);
    // A full page with a beforeSeq means more rows likely remain.
    expect(windowFromItems("c1", full, 50).hasOlder).toBe(true);
    // No beforeSeq means this is the freshest page — hasOlder is false.
    expect(windowFromItems("c1", full, null).hasOlder).toBe(false);
    expect(windowFromItems("c1", full).hasOlder).toBe(false);
  });

  it("drops rows that don't match the card or have a bad item", () => {
    const rows: CloudThreadItemRow[] = [
      { org_id: ORG, card_id: "c2", seq: 0, kind: "user", item: userMsg, at: "2026-10-15T10:00:00.000Z" },
      { org_id: ORG, card_id: "c1", seq: 1, kind: "assistant", item: { not: "an item" } as unknown as ThreadItem, at: "2026-10-15T10:00:01.000Z" },
      { org_id: ORG, card_id: "c1", seq: 2, kind: "assistant", item: assistantMsg, at: "2026-10-15T10:00:02.000Z" },
    ];
    const w = windowFromItems("c1", rows);
    expect(w.items).toHaveLength(1);
  });
});

describe("applyItemChange", () => {
  const base = {
    cardId: "c1",
    items: [] as ThreadItem[],
    hasOlder: false,
    blobRefs: [] as string[],
  };
  const userMsg: ThreadItem = { kind: "user", text: "hi", at: 1 };

  it("INSERTs a new item, unshifted to the top, and rewrites blob refs", () => {
    const tool: ThreadItem = { kind: "tool", id: "t1", name: "Bash", summary: "ls", at: 2, result: "ok", images: [REF] };
    const next = applyItemChange(base, {
      eventType: "INSERT",
      new: { org_id: ORG, card_id: "c1", seq: 1, kind: "tool", item: tool, at: "2026-10-15T10:00:00.000Z" },
    });
    expect(next.items).toHaveLength(1);
    expect(next.blobRefs).toEqual([REF]);
  });

  it("replaces an item at the same seq", () => {
    const tagged = { ...userMsg, __seq: 0 } as ThreadItem;
    const window = { ...base, items: [tagged] };
    const replacement = { ...userMsg, text: "rewritten" } as ThreadItem & { __seq?: number };
    (replacement as { __seq?: number }).__seq = 0;
    const next = applyItemChange(window, {
      eventType: "UPDATE",
      new: { org_id: ORG, card_id: "c1", seq: 0, kind: "user", item: replacement, at: "2026-10-15T10:00:00.000Z" },
    });
    expect(next.items[0]?.kind).toBe("user");
  });

  it("ignores events for other cards and DELETE without a seq", () => {
    expect(
      applyItemChange(base, {
        eventType: "INSERT",
        new: { org_id: ORG, card_id: "c2", seq: 1, kind: "user", item: userMsg, at: "2026-10-15T10:00:00.000Z" },
      }),
    ).toBe(base);
    expect(
      applyItemChange(base, {
        eventType: "DELETE",
        old: { card_id: "c1" },
      }),
    ).toBe(base);
    expect(
      applyItemChange(base, {
        eventType: "DELETE",
        old: { card_id: "c2", seq: 1 },
      }),
    ).toBe(base);
  });

  it("drops an item by seq on DELETE", () => {
    const tagged = { ...userMsg, __seq: 5 } as ThreadItem;
    const window = { ...base, items: [tagged, { ...userMsg, __seq: 6 } as ThreadItem] };
    const next = applyItemChange(window, {
      eventType: "DELETE",
      old: { card_id: "c1", seq: 5 },
    });
    expect(next.items).toHaveLength(1);
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

describe("rewriteWindowBlobRefs", () => {
  it("rewrites items inside a window and keeps cardId, hasOlder and blobRefs intact", () => {
    const window = {
      cardId: "c1",
      items: [
        { kind: "tool", id: "t", name: "Bash", summary: "x", at: 1, result: "ok", images: [REF] } as ThreadItem,
      ],
      hasOlder: true,
      blobRefs: [REF],
    };
    const out = rewriteWindowBlobRefs(window, { [REF]: "https://signed/x" });
    expect(out.cardId).toBe("c1");
    expect(out.hasOlder).toBe(true);
    expect(out.blobRefs).toEqual([REF]);
    expect((out.items[0] as { images: string[] }).images[0]).toBe("https://signed/x");
  });
});

describe("toolOutputSummary", () => {
  it("combines name, summary, size and an error tag", () => {
    expect(toolOutputSummary("Bash", "ls -la")).toBe("Bash: ls -la");
    expect(toolOutputSummary("Bash", "")).toBe("Bash");
    expect(toolOutputSummary("Bash", "x".repeat(100))).toContain("…");
    expect(toolOutputSummary("Bash", "ls", 2048)).toContain("2.0 KB");
    expect(toolOutputSummary("Bash", "ls", 5_000_000)).toContain("4.8 MB");
    expect(toolOutputSummary("Bash", "ls", 800, true)).toContain("failed");
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