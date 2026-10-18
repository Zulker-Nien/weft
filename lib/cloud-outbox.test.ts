import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OutboxEntry } from "./cloud-sync-types";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-cloud-outbox-"));
  process.env.WEFT_DATA = dir;
});
afterEach(() => {
  vi.resetModules();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function load() {
  vi.resetModules();
  return import("./cloud-outbox");
}

function entry(op: OutboxEntry["op"], cardId: string, payload: Record<string, unknown> = {}): OutboxEntry {
  if (op === "card" || op === "card_deleted") return { op, cardId, at: 0, ...payload };
  if (op === "item") return { op, cardId, seq: 0, at: 0, ...payload };
  return { op, cardId, seq: 0, at: 0, ...payload };
}

function outboxFile() {
  return path.join(dir, "sync-outbox.jsonl");
}

describe("appendOutbox / readOutbox", () => {
  it("appends one line per entry, reads them back in order", async () => {
    const { appendOutbox, readOutbox } = await load();
    expect(readOutbox()).toEqual([]);
    appendOutbox([entry("card", "a", { at: 1 }), entry("item", "a", { seq: 0, at: 2 })]);
    expect(fs.readFileSync(outboxFile(), "utf8").split("\n").filter(Boolean)).toHaveLength(2);
    expect(readOutbox()).toEqual([entry("card", "a", { at: 1 }), entry("item", "a", { seq: 0, at: 2 })]);
  });

  it("appends a second batch after the first without re-writing earlier entries", async () => {
    const { appendOutbox, readOutbox } = await load();
    appendOutbox([entry("card", "a", { at: 1 })]);
    appendOutbox([entry("item", "a", { seq: 0, at: 2 }), entry("item", "a", { seq: 1, at: 3 })]);
    expect(readOutbox()).toHaveLength(3);
  });

  it("an empty append is a no-op and never creates the file", async () => {
    const { appendOutbox, readOutbox } = await load();
    appendOutbox([]);
    expect(fs.existsSync(outboxFile())).toBe(false);
    expect(readOutbox()).toEqual([]);
  });

  it("skips a broken partial last line and still returns the good ones", async () => {
    fs.mkdirSync(path.dirname(outboxFile()), { recursive: true });
    fs.writeFileSync(outboxFile(), JSON.stringify(entry("card", "a", { at: 1 })) + "\n{not json");
    const { readOutbox } = await load();
    expect(readOutbox()).toEqual([entry("card", "a", { at: 1 })]);
  });

  it("skips a non-object line (e.g. a stray 'null') without throwing", async () => {
    fs.mkdirSync(path.dirname(outboxFile()), { recursive: true });
    fs.writeFileSync(outboxFile(), JSON.stringify(entry("card", "a", { at: 1 })) + "\nnull\n42\n" + JSON.stringify(entry("item", "a", { seq: 0, at: 2 })));
    const { readOutbox } = await load();
    expect(readOutbox()).toEqual([entry("card", "a", { at: 1 }), entry("item", "a", { seq: 0, at: 2 })]);
  });

  it("readOutbox returns [] when the file is empty", async () => {
    fs.mkdirSync(path.dirname(outboxFile()), { recursive: true });
    fs.writeFileSync(outboxFile(), "");
    const { readOutbox } = await load();
    expect(readOutbox()).toEqual([]);
  });

  it("readOutbox returns [] when the file doesn't exist", async () => {
    const { readOutbox } = await load();
    expect(readOutbox()).toEqual([]);
  });
});

describe("compactOutbox", () => {
  it("keeps the latest card / card_deleted per card (and orders by at)", async () => {
    const { compactOutbox } = await load();
    const input: OutboxEntry[] = [
      entry("card", "a", { at: 1 }),
      entry("card", "a", { at: 3 }),
      entry("card", "a", { at: 2 }),
      entry("card_deleted", "b", { at: 5 }),
    ];
    expect(compactOutbox(input)).toEqual([
      entry("card", "a", { at: 3 }),
      entry("card_deleted", "b", { at: 5 }),
    ]);
  });

  it("dedupes item entries by (cardId, seq), keeping the latest at, and sorts by at ascending", async () => {
    const { compactOutbox } = await load();
    const input: OutboxEntry[] = [
      entry("item", "a", { seq: 0, at: 1 }),
      entry("item", "a", { seq: 0, at: 5 }),
      entry("item", "a", { seq: 1, at: 2 }),
      entry("item", "a", { seq: 1, at: 4 }),
    ];
    expect(compactOutbox(input)).toEqual([
      entry("item", "a", { seq: 1, at: 4 }),
      entry("item", "a", { seq: 0, at: 5 }),
    ]);
  });

  it("drops item entries whose seq >= the truncate's seq, keeps the truncate", async () => {
    const { compactOutbox } = await load();
    const input: OutboxEntry[] = [
      entry("item", "a", { seq: 0, at: 1 }),
      entry("item", "a", { seq: 1, at: 2 }),
      entry("item", "a", { seq: 2, at: 3 }),
      entry("truncate", "a", { seq: 2, at: 4 }),
    ];
    expect(compactOutbox(input)).toEqual([
      entry("item", "a", { seq: 0, at: 1 }),
      entry("item", "a", { seq: 1, at: 2 }),
      entry("truncate", "a", { seq: 2, at: 4 }),
    ]);
  });

  it("two truncates on the same card keep the strictest (lowest seq) and drop the items it covers", async () => {
    const { compactOutbox } = await load();
    const input: OutboxEntry[] = [
      entry("item", "a", { seq: 0, at: 1 }),
      entry("item", "a", { seq: 5, at: 2 }),
      entry("truncate", "a", { seq: 6, at: 3 }),
      entry("truncate", "a", { seq: 3, at: 4 }),
    ];
    expect(compactOutbox(input)).toEqual([
      entry("item", "a", { seq: 0, at: 1 }),
      entry("truncate", "a", { seq: 3, at: 4 }),
    ]);
  });

  it("orders by at across cards and op kinds", async () => {
    const { compactOutbox } = await load();
    const input: OutboxEntry[] = [
      entry("card", "a", { at: 1 }),
      entry("item", "b", { seq: 0, at: 2 }),
      entry("card", "b", { at: 3 }),
    ];
    expect(compactOutbox(input)).toEqual(input);
  });

  it("an empty input stays empty", async () => {
    const { compactOutbox } = await load();
    expect(compactOutbox([])).toEqual([]);
  });

  it("a card entry plus an item entry for the same card keeps both, ordered by at", async () => {
    const { compactOutbox } = await load();
    const input: OutboxEntry[] = [
      entry("card", "a", { at: 1 }),
      entry("item", "a", { seq: 0, at: 2 }),
      entry("item", "a", { seq: 1, at: 3 }),
    ];
    expect(compactOutbox(input)).toEqual(input);
  });

  it("card_deleted is treated as the latest meta for the card, even when a card entry comes after", async () => {
    const { compactOutbox } = await load();
    const input: OutboxEntry[] = [
      entry("card", "a", { at: 1 }),
      entry("card_deleted", "a", { at: 2 }),
      entry("card", "a", { at: 3 }),
    ];
    expect(compactOutbox(input)).toEqual([entry("card", "a", { at: 3 })]);
  });

  it("a truncate drops items with seq >= seq, but keeps items with seq < seq for the same card", async () => {
    const { compactOutbox } = await load();
    const input: OutboxEntry[] = [
      entry("item", "a", { seq: 0, at: 1 }),
      entry("item", "a", { seq: 1, at: 2 }),
      entry("item", "a", { seq: 2, at: 3 }),
      entry("item", "a", { seq: 3, at: 4 }),
      entry("truncate", "a", { seq: 2, at: 5 }),
    ];
    expect(compactOutbox(input)).toEqual([
      entry("item", "a", { seq: 0, at: 1 }),
      entry("item", "a", { seq: 1, at: 2 }),
      entry("truncate", "a", { seq: 2, at: 5 }),
    ]);
  });

  it("a truncate's seq applies to its own card only", async () => {
    const { compactOutbox } = await load();
    const input: OutboxEntry[] = [
      entry("item", "a", { seq: 1, at: 1 }),
      entry("item", "b", { seq: 1, at: 2 }),
      entry("truncate", "a", { seq: 1, at: 3 }),
    ];
    expect(compactOutbox(input)).toEqual([
      entry("item", "b", { seq: 1, at: 2 }),
      entry("truncate", "a", { seq: 1, at: 3 }),
    ]);
  });
});

describe("replaceOutboxHead", () => {
  it("swaps the first count entries for entries and keeps later entries in place", async () => {
    const { appendOutbox, replaceOutboxHead, readOutbox } = await load();
    appendOutbox([
      entry("card", "a", { at: 1 }),
      entry("item", "a", { seq: 0, at: 2 }),
      entry("card", "b", { at: 3 }),
    ]);
    replaceOutboxHead(2, [entry("card", "b", { at: 3 })]);
    // The first two are replaced by [b@3] and the third (b@3) is kept, so the file has two b@3 entries.
    expect(readOutbox()).toEqual([entry("card", "b", { at: 3 }), entry("card", "b", { at: 3 })]);
  });

  it("leaves the file empty (with no trailing junk) when every entry is replaced with []", async () => {
    const { appendOutbox, readOutbox, replaceOutboxHead } = await load();
    appendOutbox([entry("card", "a", { at: 1 })]);
    replaceOutboxHead(1, []);
    expect(readOutbox()).toEqual([]);
    // No trailing newline when the file is empty.
    expect(fs.readFileSync(outboxFile(), "utf8")).toBe("");
  });

  it("with count 0 it prepends entries without removing any", async () => {
    const { appendOutbox, replaceOutboxHead, readOutbox } = await load();
    appendOutbox([entry("card", "a", { at: 1 })]);
    replaceOutboxHead(0, [entry("card", "b", { at: 0 })]);
    expect(readOutbox()).toEqual([
      entry("card", "b", { at: 0 }),
      entry("card", "a", { at: 1 }),
    ]);
  });

  it("keeps later appends after the swapped head (mid-upload safety)", async () => {
    const { appendOutbox, replaceOutboxHead, readOutbox } = await load();
    appendOutbox([
      entry("card", "a", { at: 1 }),
      entry("item", "a", { seq: 0, at: 2 }),
    ]);
    // Simulate a mid-upload append for the same card+seq: it must NOT be dropped.
    appendOutbox([entry("item", "a", { seq: 0, at: 3 })]);
    replaceOutboxHead(2, []);
    expect(readOutbox()).toEqual([entry("item", "a", { seq: 0, at: 3 })]);
  });

  it("creates the parent directory if it doesn't exist", async () => {
    const { replaceOutboxHead, readOutbox } = await load();
    // Outbox file doesn't exist yet, but the rewrite should create it.
    replaceOutboxHead(0, [entry("card", "a", { at: 1 })]);
    expect(fs.existsSync(outboxFile())).toBe(true);
    expect(readOutbox()).toEqual([entry("card", "a", { at: 1 })]);
  });

  it("swapping the entire file is a true replacement, not a merge", async () => {
    const { appendOutbox, replaceOutboxHead, readOutbox } = await load();
    appendOutbox([entry("card", "a", { at: 1 }), entry("card", "b", { at: 2 })]);
    replaceOutboxHead(2, [entry("card", "c", { at: 9 })]);
    expect(readOutbox()).toEqual([entry("card", "c", { at: 9 })]);
  });

  it("a truncate entry survives a swap (it sits in the tail and stays)", async () => {
    const { appendOutbox, replaceOutboxHead, readOutbox } = await load();
    appendOutbox([
      entry("item", "a", { seq: 0, at: 1 }),
      entry("truncate", "a", { seq: 1, at: 2 }),
    ]);
    replaceOutboxHead(1, []);
    expect(readOutbox()).toEqual([entry("truncate", "a", { seq: 1, at: 2 })]);
  });
});
