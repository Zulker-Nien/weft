import { describe, expect, it, vi } from "vitest";
import { blanksIn, fillBlanks, isFinished, leavesBoard, libraryCounts, libraryGroups, libraryItemMenu, libraryPinned, setLibraryPinned, todoProgress } from "./library-view";
import type { LibraryItem } from "./types";

let seq = 0;
const item = (over: Partial<LibraryItem> = {}): LibraryItem =>
  ({ id: `i${++seq}`, kind: "note", scope: "project", title: "t", folder: "/dev/app", createdAt: 0, updatedAt: 0, ...over });

describe("isFinished", () => {
  it("is a to-do with steps, all of them ticked", () => {
    expect(isFinished(item({ kind: "todo", steps: 2, ticked: [0, 1] }))).toBe(true);
    expect(isFinished(item({ kind: "todo", steps: 2, ticked: [0] }))).toBe(false);
    expect(isFinished(item({ kind: "todo", steps: 2 }))).toBe(false);
    expect(isFinished(item({ kind: "todo", ticked: [] }))).toBe(false);
    expect(isFinished(item({ kind: "note", steps: 1, ticked: [0] }))).toBe(false);
  });
});

describe("leavesBoard", () => {
  it("takes a card filed as a to-do off the board", () => {
    expect(leavesBoard("todo", { column: "review" })).toBe(true);
    expect(leavesBoard("todo", { column: "needs_you" })).toBe(true);
  });
  it("leaves recipes, notes, running cards and archived cards alone", () => {
    expect(leavesBoard("recipe", { column: "review" })).toBe(false);
    expect(leavesBoard("note", { column: "done" })).toBe(false);
    expect(leavesBoard("todo", { column: "running" })).toBe(false);
    expect(leavesBoard("todo", { column: "done", archived: true })).toBe(false);
  });
});

describe("libraryCounts", () => {
  const items = [
    item({ kind: "recipe", scope: "mine" }),
    item({ kind: "recipe", folder: "/dev/app" }),
    item({ kind: "note", folder: "/dev/other" }),
    item({ kind: "todo", folder: "/dev/app", steps: 1 }),
    item({ kind: "todo", folder: "/dev/app", steps: 1, ticked: [0] }),
  ];

  it("counts yours and the board's project in project view, leaving out finished to-dos", () => {
    expect(libraryCounts(items, "project", "/dev/app")).toEqual({ recipe: 2, todo: 1, note: 0 });
  });

  it("counts only yours in mine view, and everything in all view", () => {
    expect(libraryCounts(items, "mine", "/dev/app")).toEqual({ recipe: 1, todo: 0, note: 0 });
    expect(libraryCounts(items, "all", null)).toEqual({ recipe: 2, todo: 1, note: 1 });
  });

  it("shows only yours in project view with no project", () => {
    expect(libraryCounts(items, "project", null)).toEqual({ recipe: 1, todo: 0, note: 0 });
  });
});

describe("libraryGroups", () => {
  it("groups one kind by project, the board's first, others by name, yours last", () => {
    const items = [
      item({ id: "mine", scope: "mine", folder: "/dev/app" }),
      item({ id: "zeta", folder: "/dev/zeta" }),
      item({ id: "alpha", folder: "C:\\dev\\alpha\\" }),
      item({ id: "app", folder: "/dev/app" }),
      item({ id: "recipe", kind: "recipe", folder: "/dev/app" }),
    ];
    const groups = libraryGroups(items, "note", "all", "/dev/app");
    expect(groups.map((g) => [g.key, g.label, g.items.map((i) => i.id)])).toEqual([
      ["/dev/app", "app", ["app"]],
      ["C:\\dev\\alpha\\", "alpha", ["alpha"]],
      ["/dev/zeta", "zeta", ["zeta"]],
      ["~mine", "Mine", ["mine"]],
    ]);
  });

  it("keeps out what's not in view", () => {
    const items = [item({ id: "mine", scope: "mine" }), item({ id: "other", folder: "/dev/other" })];
    expect(libraryGroups(items, "note", "mine", "/dev/app").map((g) => g.key)).toEqual(["~mine"]);
    expect(libraryGroups(items, "note", "project", "/dev/app").map((g) => g.key)).toEqual(["~mine"]);
  });

  it("orders each group newest first with finished to-dos at the bottom", () => {
    const items = [
      item({ id: "old", kind: "todo", updatedAt: 1, steps: 2 }),
      item({ id: "done-new", kind: "todo", updatedAt: 9, steps: 1, ticked: [0] }),
      item({ id: "new", kind: "todo", updatedAt: 5, steps: 2 }),
      item({ id: "done-old", kind: "todo", updatedAt: 2, steps: 1, ticked: [0] }),
    ];
    expect(libraryGroups(items, "todo", "project", "/dev/app")[0]!.items.map((i) => i.id)).toEqual(["new", "old", "done-new", "done-old"]);
  });

  it("labels a folder that's only separators with the folder itself", () => {
    expect(libraryGroups([item({ folder: "/" })], "note", "all", null)[0]!.label).toBe("/");
  });
});

describe("todoProgress", () => {
  it("is undefined for notes, recipes and to-dos with no checkboxes", () => {
    expect(todoProgress(item({ kind: "note", steps: 3 }))).toBeUndefined();
    expect(todoProgress(item({ kind: "todo" }))).toBeUndefined();
    expect(todoProgress(item({ kind: "todo", steps: 0 }))).toBeUndefined();
  });

  it("reads ticks out of steps, capped at all done", () => {
    expect(todoProgress(item({ kind: "todo", steps: 4 }))).toEqual({ fraction: 0, label: "0 of 4 done" });
    expect(todoProgress(item({ kind: "todo", steps: 4, ticked: [0, 2] }))).toEqual({ fraction: 0.5, label: "2 of 4 done" });
    expect(todoProgress(item({ kind: "todo", steps: 2, ticked: [0, 1, 2] }))).toEqual({ fraction: 1, label: "All done" });
  });
});

describe("blanksIn and fillBlanks", () => {
  it("finds named {blanks} once each, in order, and leaves code braces alone", () => {
    expect(blanksIn("Kit for {product}, for {audience}; again {product}. Code: { a: 1 } {1x}")).toEqual(["product", "audience"]);
  });

  it("reads a blank the Markdown editor escaped, {item\\_kinds}, as item_kinds", () => {
    expect(blanksIn("Make {item\\_kinds} for {brand_name}")).toEqual(["item_kinds", "brand_name"]);
    expect(fillBlanks("Make {item\\_kinds}", { item_kinds: "notes" })).toBe("Make notes");
  });

  it("fills the blanks it has values for and keeps the rest", () => {
    expect(fillBlanks("Kit for {product}, for {audience}", { product: " Zeph ", audience: "" })).toBe("Kit for Zeph, for {audience}");
  });
});

describe("libraryPinned", () => {
  it("is off with no storage, and remembers what you set", () => {
    expect(libraryPinned()).toBe(false);
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) });
    setLibraryPinned(true);
    expect(libraryPinned()).toBe(true);
    setLibraryPinned(false);
    expect(libraryPinned()).toBe(false);
    vi.unstubAllGlobals();
  });
});

describe("libraryItemMenu", () => {
  const ids = (menu: ReturnType<typeof libraryItemMenu>) => menu.flatMap((m) => ("id" in m ? [m.id] : []));

  it("runs a recipe and shows its page; opens a to-do's or note's page", () => {
    expect(ids(libraryItemMenu(item({ kind: "recipe" }), false))).toEqual(["run", "open", "scope", "remove"]);
    expect(ids(libraryItemMenu(item({ kind: "todo" }), true))).toEqual(["open", "card", "scope", "kind", "remove"]);
  });

  it("moves between Mine and the project, and swaps to-do and note", () => {
    const label = (menu: ReturnType<typeof libraryItemMenu>, id: string) => menu.find((m) => "id" in m && m.id === id) as { label: string };
    expect(label(libraryItemMenu(item({ scope: "mine", folder: "/dev/app" }), false), "scope").label).toBe("Move to app (This Project Only)");
    expect(label(libraryItemMenu(item({ scope: "project" }), false), "scope").label).toBe("Move to Mine (Every Project)");
    expect(label(libraryItemMenu(item({ kind: "note" }), false), "kind").label).toBe("Make It a To-do");
    expect(label(libraryItemMenu(item({ kind: "recipe" }), false), "remove").label).toBe("Remove Recipe (and Its Skill)");
  });
});
