import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "./types";

// store.ts reads THREADBOARD_DATA once at import, so each test points it at a fresh temp dir
// and re-imports the module. Never the real ~/.weft.
let dir: string;
const g = globalThis as unknown as { __threadboardState?: unknown };

async function load() {
  vi.resetModules();
  delete g.__threadboardState;
  return import("./store");
}

type Store = Awaited<ReturnType<typeof load>>;
const input = (over: Partial<Card> = {}) =>
  ({ title: "t", prompt: "p", cwd: "/tmp", backend: "claude", ...over }) as Parameters<Store["createCard"]>[0];

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-store-"));
  process.env.THREADBOARD_DATA = dir;
});
afterEach(() => {
  delete g.__threadboardState;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("store cards", () => {
  it("creates a backlog card, saves it, and lists newest-updated first", async () => {
    const store = await load();
    const a = store.createCard(input({ title: "a" }), "a");
    expect(a.column).toBe("backlog");
    store.createCard(input({ title: "b" }), "b");
    await new Promise((r) => setTimeout(r, 5));
    store.updateCard("a", { title: "a2" });
    expect(store.listCards().map((c) => c.id)).toEqual(["a", "b"]);
    const saved = JSON.parse(fs.readFileSync(path.join(dir, "board.json"), "utf8"));
    expect(saved.cards.map((c: Card) => c.title).sort()).toEqual(["a2", "b"]);
  });

  it("updateCard throws for an unknown card", async () => {
    const store = await load();
    expect(() => store.updateCard("nope", {})).toThrow("No card nope");
  });

  it("deletes the card and its thread file", async () => {
    const store = await load();
    store.createCard(input(), "x");
    store.appendThread("x", { kind: "user", text: "hi", at: 1 });
    expect(fs.existsSync(path.join(dir, "threads", "x.json"))).toBe(true);
    store.deleteCard("x");
    expect(store.getCard("x")).toBeUndefined();
    expect(fs.existsSync(path.join(dir, "threads", "x.json"))).toBe(false);
  });

  it("publishes card events on the bus", async () => {
    const store = await load();
    const { subscribe } = await import("./bus");
    const seen: string[] = [];
    const off = subscribe((e) => seen.push(e.type));
    store.createCard(input(), "e");
    store.deleteCard("e");
    off();
    expect(seen).toEqual(["card", "card_deleted"]);
  });

  it("on restart, a running card or one with a pending permission lands in review", async () => {
    fs.mkdirSync(dir, { recursive: true });
    const base = { prompt: "p", cwd: "/", backend: "claude", createdAt: 1, updatedAt: 1, warm: true };
    fs.writeFileSync(
      path.join(dir, "board.json"),
      JSON.stringify({
        cards: [
          { ...base, id: "r", title: "r", column: "running" },
          { ...base, id: "p", title: "p", column: "needs_you", pending: { id: "1" } },
          { ...base, id: "d", title: "d", column: "done" },
        ],
      }),
    );
    const store = await load();
    const r = store.getCard("r")!;
    expect(r.column).toBe("review");
    expect(r.lastLine).toBe("Stopped when the app closed");
    expect(r.warm).toBe(false);
    expect(store.getCard("p")!.column).toBe("review");
    expect(store.getCard("p")!.pending).toBeNull();
    expect(store.getCard("d")!.column).toBe("done");
  });

  it("addCards saves many at once", async () => {
    const store = await load();
    const mk = (id: string) => ({ ...input(), id, column: "done", createdAt: 1, updatedAt: 1 }) as Card;
    store.addCards([mk("1"), mk("2")]);
    expect(store.listCards()).toHaveLength(2);
  });
});

describe("store threads", () => {
  it("append returns the index, persists, and survives a reload", async () => {
    let store = await load();
    expect(store.appendThread("c", { kind: "user", text: "one", at: 1 })).toBe(0);
    expect(store.appendThread("c", { kind: "assistant", text: "two", at: 2 })).toBe(1);
    store = await load();
    expect(store.getThread("c").map((i) => i.kind)).toEqual(["user", "assistant"]);
  });

  it("replaceThreadItem, replaceThread and clearThread", async () => {
    const store = await load();
    store.appendThread("c", { kind: "user", text: "one", at: 1 });
    store.replaceThreadItem("c", 0, { kind: "user", text: "edited", at: 1 });
    expect((store.getThread("c")[0] as { text: string }).text).toBe("edited");
    store.replaceThread("c", [
      { kind: "user", text: "a", at: 1 },
      { kind: "user", text: "b", at: 2 },
    ]);
    expect(store.getThread("c")).toHaveLength(2);
    store.clearThread("c");
    expect(store.getThread("c")).toEqual([]);
    expect(JSON.parse(fs.readFileSync(path.join(dir, "threads", "c.json"), "utf8"))).toEqual([]);
  });

  it("an unknown thread is empty", async () => {
    const store = await load();
    expect(store.getThread("never")).toEqual([]);
  });
});
