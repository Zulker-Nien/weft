import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BlobStore, OutboxEntry } from "./cloud-sync-types";
import type { Card, ThreadItem } from "./types";

const cards = new Map<string, Card>();
const threads = new Map<string, ThreadItem[]>();

vi.mock("./store", () => ({
  getCard: (id: string) => cards.get(id),
  getThread: (id: string) => threads.get(id) ?? [],
  listCards: () => [...cards.values()],
  get DATA_DIR() {
    return process.env.WEFT_DATA;
  },
}));

const blobs: BlobStore = {
  refFor: vi.fn(() => Promise.resolve(null)),
  upload: vi.fn(() => Promise.resolve(null)),
  rewriteItem: (item) => Promise.resolve(item),
};

type Upsert = (rows: Record<string, unknown>[]) => { error: { message: string; code?: string } | null };

// A Supabase client that records every upsert per table and answers through a script per table.
function fakeClient(script: Partial<Record<string, Upsert>> = {}) {
  const sent: Record<string, Record<string, unknown>[][]> = {};
  const client = {
    from: (table: string) => ({
      upsert: (rows: Record<string, unknown>[]) => {
        (sent[table] ??= []).push(rows);
        return Promise.resolve(script[table]?.(rows) ?? { error: null });
      },
      update: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }),
      delete: () => ({ eq: () => ({ eq: () => ({ gte: () => Promise.resolve({ error: null }) }) }) }),
    }),
  };
  return { client: client as never, sent };
}

let dir: string;

beforeEach(() => {
  vi.resetModules();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-cloud-upload-"));
  process.env.WEFT_DATA = dir;
  cards.clear();
  threads.clear();
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function addCard(id: string, items: Record<string, unknown>[]) {
  cards.set(id, { id, title: id, prompt: "", cwd: "/sync", backend: "claude", permissionMode: "default", column: "review", createdAt: 0, updatedAt: 0 });
  threads.set(id, items.map((item, i) => ({ kind: "assistant", text: `m${i}`, at: 1000 + i, ...item })));
}

const itemEntries = (id: string, n: number): OutboxEntry[] => Array.from({ length: n }, (_, seq) => ({ op: "item", cardId: id, seq, at: 1 }));

async function run(pending: OutboxEntry[], client: never) {
  const { appendOutbox, readOutbox } = await import("./cloud-outbox");
  const { uploadPending } = await import("./cloud-sync-upload");
  appendOutbox(pending);
  const shipped: number[] = [];
  const skipped = await uploadPending({ blobs, now: () => 5000 }, client, "o1", pending, (n) => shipped.push(n));
  return { skipped, shipped, left: readOutbox() };
}

describe("scrub", () => {
  it("drops NULs and replaces lone surrogates, deep in objects and arrays, and leaves clean values alone", async () => {
    const { scrub } = await import("./cloud-sync-upload");
    expect(scrub("a\u0000b")).toBe("ab");
    expect(scrub("x\ud83dy")).toBe("x�y");
    expect(scrub("lone low \ude00")).toBe("lone low �");
    expect(scrub("ok \u{1F600} fine")).toBe("ok \u{1F600} fine");
    expect(scrub({ a: ["\u0000", { b: "c\u0000d", n: 3, t: true, z: null }] })).toEqual({ a: ["", { b: "cd", n: 3, t: true, z: null }] });
  });
});

describe("uploadPending", () => {
  it("sends a NUL-bearing item and card without the NUL, instead of failing the whole batch", async () => {
    addCard("c1", [{ text: "ran ls\u0000 done" }]);
    cards.get("c1")!.title = "bad\u0000title";
    const { client, sent } = fakeClient();
    const { left } = await run([{ op: "card", cardId: "c1", at: 1 }, ...itemEntries("c1", 1)], client);
    expect(JSON.stringify(sent)).not.toContain("\\u0000");
    expect((sent.cloud_cards![0]![0]!.card as Card).title).toBe("badtitle");
    expect(sent.cloud_thread_items).toHaveLength(1);
    expect(left).toEqual([]);
  });

  it("uploads in chunks and drops each from the outbox as it lands, so a late failure keeps only the rest", async () => {
    addCard("c1", Array.from({ length: 250 }, () => ({})));
    let calls = 0;
    const { client, sent } = fakeClient({ cloud_thread_items: () => (++calls === 3 ? { error: { message: "fetch failed", code: "" } } : { error: null }) });
    const { appendOutbox, readOutbox } = await import("./cloud-outbox");
    const { uploadPending, ITEM_CHUNK } = await import("./cloud-sync-upload");
    const pending = itemEntries("c1", 250);
    appendOutbox(pending);
    const shipped: number[] = [];
    await expect(uploadPending({ blobs, now: () => 5000 }, client, "o1", pending, (n) => shipped.push(n))).rejects.toThrow("fetch failed");
    expect(ITEM_CHUNK).toBe(100);
    expect(sent.cloud_thread_items!.map((rows) => rows.length)).toEqual([100, 100, 50]);
    expect(shipped).toEqual([100, 100]);
    expect(readOutbox()).toHaveLength(50);
    expect(readOutbox()[0]).toMatchObject({ op: "item", seq: 200 });
  });

  it("skips the one row the server refuses for good and ships the rest of its chunk", async () => {
    addCard("c1", [{ text: "ok" }, { text: "poison" }, { text: "fine" }] as Partial<ThreadItem>[]);
    const reject: Upsert = (rows) =>
      rows.some((r) => (r.item as { text?: string }).text === "poison") ? { error: { message: "unsupported Unicode escape sequence", code: "22P05" } } : { error: null };
    const { client, sent } = fakeClient({ cloud_thread_items: reject });
    const { skipped, shipped, left } = await run(itemEntries("c1", 3), client);
    expect(skipped).toEqual({ count: 1, message: "unsupported Unicode escape sequence" });
    expect(shipped).toEqual([1, 1]);
    expect(sent.cloud_thread_items).toHaveLength(4);
    expect(left).toEqual([]);
  });

  it("does not skip rows for an error that isn't about the data, such as row-level security or a dead connection", async () => {
    addCard("c1", [{}, {}]);
    const { client } = fakeClient({ cloud_thread_items: () => ({ error: { message: "new row violates row-level security policy", code: "42501" } }) });
    const { appendOutbox, readOutbox } = await import("./cloud-outbox");
    const { uploadPending } = await import("./cloud-sync-upload");
    appendOutbox(itemEntries("c1", 2));
    await expect(uploadPending({ blobs, now: () => 5000 }, client, "o1", itemEntries("c1", 2), () => {})).rejects.toThrow("row-level security");
    expect(readOutbox()).toHaveLength(2);
  });

  it("sends a long tool result to cloud_tool_outputs and a card_deleted/truncate through their own calls", async () => {
    addCard("c1", [{ kind: "tool", id: "t1", name: "Read", result: "x".repeat(5000) }]);
    const { client, sent } = fakeClient();
    const { shipped, left } = await run(
      [
        { op: "truncate", cardId: "c1", seq: 5, at: 1 },
        { op: "card_deleted", cardId: "gone", at: 1 },
        ...itemEntries("c1", 1),
      ],
      client,
    );
    expect(sent.cloud_tool_outputs![0]![0]).toMatchObject({ tool_id: "t1", bytes: 5000 });
    expect(shipped).toEqual([1]);
    expect(left).toEqual([]);
  });

  it("sends one tool output per tool id in a request, the latest, when a thread reuses an id", async () => {
    const tool = (result: string) => ({ kind: "tool", id: "item_1", name: "Bash", result });
    addCard("c1", [tool("a".repeat(3000)), { text: "between" }, tool("b".repeat(4000))]);
    const { client, sent } = fakeClient();
    await run(itemEntries("c1", 3), client);
    expect(sent.cloud_tool_outputs).toHaveLength(1);
    expect(sent.cloud_tool_outputs![0]).toHaveLength(1);
    expect(sent.cloud_tool_outputs![0]![0]).toMatchObject({ tool_id: "item_1", bytes: 4000 });
    expect(sent.cloud_thread_items![0]).toHaveLength(3);
  });

  it("consumes entries whose card or item is gone without sending them", async () => {
    addCard("c1", [{}]);
    const { client, sent } = fakeClient();
    const { shipped, left } = await run([...itemEntries("c1", 1), { op: "item", cardId: "c1", seq: 9, at: 1 }, { op: "item", cardId: "nope", seq: 0, at: 1 }], client);
    expect(shipped).toEqual([1]);
    expect(sent.cloud_thread_items).toHaveLength(1);
    expect(left).toEqual([]);
  });
});
