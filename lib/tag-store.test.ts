import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardEvent } from "./types";

// The catalog against a real store in a temp dir (THREADBOARD_DATA), never the real ~/.weft.
let dir: string;
const g = globalThis as unknown as { __threadboardState?: unknown };

async function load() {
  vi.resetModules();
  delete g.__threadboardState;
  const store = await import("./store");
  const tags = await import("./tag-store");
  const { subscribe } = await import("./bus");
  return { store, tags, subscribe };
}

type Loaded = Awaited<ReturnType<typeof load>>;
const catalogFile = () => path.join(dir, "tags.json");
const catalog = () => (JSON.parse(fs.readFileSync(catalogFile(), "utf8")) as { tags: unknown[] }).tags;

function addCard({ store }: Loaded, id: string, tags?: string[]) {
  store.createCard({ title: id, prompt: "p", cwd: "/tmp", backend: "claude", permissionMode: "default", ...(tags ? { tags } : {}) }, id);
}
const tagsOf = ({ store }: Loaded, id: string) => store.getCard(id)?.tags;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-tags-"));
  process.env.THREADBOARD_DATA = dir;
});
afterEach(() => {
  delete g.__threadboardState;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("listTags", () => {
  it("is the catalog plus every tag on a card, with counts, by name", async () => {
    const t = await load();
    expect(t.tags.listTags()).toEqual([]);
    t.tags.createTag("launch", "#00ff00", "Ship it");
    addCard(t, "a", ["bug", "ui"]);
    addCard(t, "b", ["bug"]);
    addCard(t, "c");
    expect(t.tags.listTags()).toEqual([
      { name: "bug", count: 2 },
      { name: "launch", color: "#00ff00", description: "Ship it", count: 0 },
      { name: "ui", count: 1 },
    ]);
  });

  it("reads a broken or empty catalog as empty", async () => {
    const t = await load();
    fs.writeFileSync(catalogFile(), "{not json");
    expect(t.tags.listTags()).toEqual([]);
    fs.writeFileSync(catalogFile(), "{}");
    expect(t.tags.listTags()).toEqual([]);
  });
});

describe("createTag", () => {
  it("normalizes the name, colour and description, leaving out what's empty", async () => {
    const t = await load();
    expect(t.tags.createTag("  #Bug  Fix ", "FF0000", "  needs   a look  ")).toEqual({ name: "bug fix", color: "#ff0000", description: "needs a look" });
    expect(t.tags.createTag("docs", "", "  ")).toEqual({ name: "docs" });
    expect(t.tags.createTag("ops", null, "x".repeat(150)).description).toHaveLength(100);
    expect(catalog()).toHaveLength(3);
  });

  it("refuses no name, a duplicate and a bad colour", async () => {
    const t = await load();
    t.tags.createTag("bug");
    expect(() => t.tags.createTag(" # ")).toThrow("A tag needs a name.");
    expect(() => t.tags.createTag(42)).toThrow("A tag needs a name.");
    expect(() => t.tags.createTag("BUG")).toThrow("already a tag “bug”");
    expect(() => t.tags.createTag("ui", "red")).toThrow("#rrggbb");
    expect(() => t.tags.createTag("ui", 7)).toThrow("#rrggbb");
  });
});

describe("updateTag", () => {
  it("recolours and redescribes, keeping what isn't given", async () => {
    const t = await load();
    t.tags.createTag("bug", "#ff0000", "Broken");
    expect(t.tags.updateTag("bug", { color: "#00ff00" })).toEqual({ name: "bug", color: "#00ff00", description: "Broken" });
    expect(t.tags.updateTag("bug", { description: "" })).toEqual({ name: "bug", color: "#00ff00" });
    expect(t.tags.updateTag("bug", { color: "" })).toEqual({ name: "bug" });
  });

  it("renames on every card, publishing each card it changes", async () => {
    const t = await load();
    t.tags.createTag("bug", "#ff0000");
    addCard(t, "a", ["bug", "ui"]);
    addCard(t, "b", ["ui"]);
    const seen: BoardEvent[] = [];
    const off = t.subscribe((e) => seen.push(e));
    expect(t.tags.updateTag("bug", { name: "Defect" })).toEqual({ name: "defect", color: "#ff0000" });
    off();
    expect(tagsOf(t, "a")).toEqual(["defect", "ui"]);
    expect(tagsOf(t, "b")).toEqual(["ui"]);
    expect(seen.map((e) => (e.type === "card" ? e.card.id : e.type))).toEqual(["a"]);
    expect(t.tags.listTags().map((r) => r.name)).toEqual(["defect", "ui"]);
  });

  it("renaming onto a tag that exists merges them, on cards and in the catalog", async () => {
    const t = await load();
    t.tags.createTag("defect", "#0000ff", "Kept");
    addCard(t, "a", ["bug", "defect"]);
    // "bug" is only on a card, not in the catalog, and can still be renamed.
    expect(t.tags.updateTag("bug", { name: "defect" })).toEqual({ name: "defect", color: "#0000ff", description: "Kept" });
    expect(tagsOf(t, "a")).toEqual(["defect"]);
    expect(catalog()).toEqual([{ name: "defect", color: "#0000ff", description: "Kept" }]);
  });

  it("refuses a tag that doesn't exist, or a blank new name", async () => {
    const t = await load();
    addCard(t, "a");
    expect(() => t.tags.updateTag("nope", { color: "#000000" })).toThrow("No tag “nope”");
    t.tags.createTag("bug");
    expect(() => t.tags.updateTag("bug", { name: " " })).toThrow("A tag needs a name.");
  });
});

describe("deleteTag", () => {
  it("takes it out of the catalog and off every card", async () => {
    const t = await load();
    t.tags.createTag("bug");
    t.tags.createTag("ui");
    addCard(t, "a", ["bug", "ui"]);
    t.tags.deleteTag("#Bug");
    expect(tagsOf(t, "a")).toEqual(["ui"]);
    expect(catalog()).toEqual([{ name: "ui" }]);
    expect(() => t.tags.deleteTag("")).toThrow("A tag needs a name.");
  });
});

describe("rememberTags", () => {
  it("adds only tags the catalog doesn't have, and writes nothing when there are none", async () => {
    const t = await load();
    t.tags.rememberTags([]);
    expect(fs.existsSync(catalogFile())).toBe(false);
    t.tags.createTag("bug", "#ff0000");
    t.tags.rememberTags(["Bug", "ui", "ui"]);
    expect(catalog()).toEqual([{ name: "bug", color: "#ff0000" }, { name: "ui" }]);
  });
});
