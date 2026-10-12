import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "./types";

// The library gave way to ★ and tags: lib/store.ts moves library cards over as it loads the board.
// Each test points THREADBOARD_DATA at a fresh temp dir and re-imports the store. Never the real ~/.weft.
let dir: string;
const g = globalThis as unknown as { __threadboardState?: unknown };

async function load() {
  vi.resetModules();
  delete g.__threadboardState;
  return import("./store");
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-store-migrate-"));
  process.env.THREADBOARD_DATA = dir;
});
afterEach(() => {
  delete g.__threadboardState;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("store library migration", () => {
  const base = { prompt: "p", cwd: "/tmp", backend: "claude", permissionMode: "default", column: "review", createdAt: 1, updatedAt: 1 };
  const writeIndex = (sub: string, items: unknown) => {
    fs.mkdirSync(path.join(dir, "library", sub), { recursive: true });
    fs.writeFileSync(path.join(dir, "library", sub, "items.json"), JSON.stringify({ items }));
  };

  it("stars library cards, tags them with their old kind, drops libraryId and recipeId, and saves once", async () => {
    writeIndex("", [{ id: "n1", kind: "note" }, { id: "t1", kind: "todo" }]);
    writeIndex("projects/-dev-app", [{ id: "r1", kind: "recipe" }]);
    // A broken index and an index with no items are skipped.
    writeIndex("projects/-dev-broken", null);
    fs.writeFileSync(path.join(dir, "library", "projects", "-dev-broken", "items.json"), "{not json");
    writeIndex("projects/-dev-empty", undefined);
    const cards = [
      { ...base, id: "a", title: "a", libraryId: "n1", tags: ["ui"] },
      { ...base, id: "b", title: "b", libraryId: "t1" },
      { ...base, id: "c", title: "c", libraryId: "r1" },
      { ...base, id: "d", title: "d", libraryId: "gone" },
      { ...base, id: "e", title: "e", recipeId: "r1" },
      { ...base, id: "f", title: "f" },
    ];
    fs.writeFileSync(path.join(dir, "board.json"), JSON.stringify({ cards }));
    const store = await load();
    const get = (id: string) => store.getCard(id) as Card & { libraryId?: string; recipeId?: string };
    expect(get("a")).toMatchObject({ starred: true, tags: ["ui", "note"], tagsBy: "user" });
    expect(get("b")).toMatchObject({ starred: true, tags: ["to-do"] });
    expect(get("c")).toMatchObject({ starred: true, tags: ["recipe"] });
    expect(get("d")).toMatchObject({ starred: true });
    expect(get("d").tags).toBeUndefined();
    expect(get("e").starred).toBeUndefined();
    for (const id of ["a", "b", "c", "d", "e"]) expect(get(id)).not.toHaveProperty("libraryId");
    expect(get("e")).not.toHaveProperty("recipeId");
    const saved = JSON.parse(fs.readFileSync(path.join(dir, "board.json"), "utf8")) as { cards: Record<string, unknown>[] };
    expect(saved.cards.some((c) => "libraryId" in c || "recipeId" in c)).toBe(false);
    // The library folder is left alone.
    expect(fs.existsSync(path.join(dir, "library", "items.json"))).toBe(true);
  });

  it("does nothing, and writes nothing, when no card came from the library or there's no library", async () => {
    fs.writeFileSync(path.join(dir, "board.json"), JSON.stringify({ cards: [{ ...base, id: "f", title: "f" }] }));
    const write = vi.spyOn(fs, "writeFileSync");
    await load();
    expect(write).not.toHaveBeenCalled();
    write.mockRestore();
    fs.writeFileSync(path.join(dir, "board.json"), JSON.stringify({ cards: [{ ...base, id: "g", title: "g", libraryId: "x" }] }));
    const store = await load();
    expect(store.getCard("g")).toMatchObject({ starred: true });
  });
});
