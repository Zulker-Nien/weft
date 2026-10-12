// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { makeCard } from "./test-utils";
import { boardPaletteItems, promptItems, type PaletteActions, type PaletteState } from "./board-palette";

vi.mock("@/lib/theme", () => ({ THEMES: [{ id: "dark", label: "Dark" }], SCENES: [{ id: "canyon", label: "Canyon" }], setTheme: vi.fn() }));

function actions(): PaletteActions {
  const names = [
    "openNew", "focusFilter", "toggleCopilot", "toggleBrowser", "toggleTerminal", "openSettings", "openHelp", "addSecret",
    "jumpToNeedsYou", "archiveCards", "unarchive", "toggleShowArchived", "chooseSort", "focusReply", "closeThread",
    "toggleArchive", "stop", "move", "chooseProject", "openCard",
  ];
  return Object.fromEntries(names.map((n) => [n, vi.fn()])) as unknown as PaletteActions;
}

function state(over: Partial<PaletteState> = {}): PaletteState {
  return {
    cards: [],
    selected: null,
    projectSummaries: [],
    home: "/Users/me",
    doneToArchive: [],
    lastArchived: [],
    archivedCount: 0,
    showArchived: false,
    rootOf: (cwd) => cwd,
    ...over,
  };
}

const ids = (items: { id: string }[]) => items.map((i) => i.id);

describe("boardPaletteItems", () => {
  it("lists the board's commands, All projects, and no thread commands with nothing open", () => {
    const items = boardPaletteItems(state(), actions());
    expect(ids(items)).toContain("cmd-new");
    expect(ids(items)).toContain("cmd-theme-dark");
    expect(ids(items)).toContain("cmd-theme-canyon");
    expect(ids(items)).toContain("cmd-add-secret");
    expect(ids(items)).toContain("project-all");
    expect(ids(items)).not.toContain("cmd-reply");
    expect(ids(items)).not.toContain("cmd-archive-done");
    expect(ids(items)).not.toContain("cmd-archive-undo");
    expect(ids(items)).not.toContain("cmd-toggle-archived");
  });

  it("offers archive commands when there is something to archive, undo or show", () => {
    const done = [makeCard({ id: "d1", column: "done" })];
    const a = actions();
    const items = boardPaletteItems(state({ doneToArchive: done, lastArchived: ["x"], archivedCount: 3, showArchived: true }), a);
    const byId = new Map(items.map((i) => [i.id, i]));
    expect(byId.get("cmd-archive-done")?.label).toBe("Archive all 1 in Done");
    expect(byId.get("cmd-toggle-archived")?.label).toBe("Hide 3 archived");
    byId.get("cmd-archive-done")?.run();
    byId.get("cmd-archive-undo")?.run();
    expect(a.archiveCards).toHaveBeenCalledWith(done);
    expect(a.unarchive).toHaveBeenCalledWith(["x"]);
  });

  it("puts the open thread's commands first, with Stop only while it runs", () => {
    const selected = makeCard({ id: "s1", column: "running", archived: true });
    const a = actions();
    const items = boardPaletteItems(state({ selected, cards: [selected] }), a);
    expect(items[0]?.id).toBe("cmd-reply");
    const byId = new Map(items.map((i) => [i.id, i]));
    expect(byId.get("cmd-archive")?.label).toBe("Unarchive the open thread");
    expect(byId.has("cmd-move-running")).toBe(false);
    byId.get("cmd-stop")?.run();
    byId.get("cmd-move-done")?.run();
    expect(a.stop).toHaveBeenCalledWith("s1");
    expect(a.move).toHaveBeenCalledWith("s1", "done");
    const idle = boardPaletteItems(state({ selected: makeCard({ column: "review" }) }), a);
    expect(ids(idle)).not.toContain("cmd-stop");
  });

  it("lists projects with home shortened, and cards but not the copilot", () => {
    const a = actions();
    const card = makeCard({ id: "c1", lastLine: "done it" });
    const items = boardPaletteItems(
      state({
        projectSummaries: [{ path: "/Users/me/dev/app" }, { path: "/srv/site" }] as PaletteState["projectSummaries"],
        cards: [card, makeCard({ id: "cp", role: "copilot" })],
      }),
      a,
    );
    const byId = new Map(items.map((i) => [i.id, i]));
    expect(byId.get("project-/Users/me/dev/app")?.detail).toBe("~/dev/app");
    expect(byId.get("project-/srv/site")?.detail).toBe("/srv/site");
    expect(byId.has("card-cp")).toBe(false);
    expect(byId.get("card-c1")?.keywords).toContain("done it");
    byId.get("project-all")?.run();
    byId.get("card-c1")?.run();
    expect(a.chooseProject).toHaveBeenCalledWith(null);
    expect(a.openCard).toHaveBeenCalledWith(card);
  });

  it("gives each card its last line of output (or its error) and how long ago it changed", () => {
    const now = Date.now();
    const cards = [
      makeCard({ id: "c1", lastLine: "Built the\n  login page", updatedAt: now - 5 * 60_000 }),
      makeCard({ id: "c2", lastLine: "old", error: "Rate limited", updatedAt: now }),
      makeCard({ id: "c3", lastLine: "  " }),
    ];
    const byId = new Map(boardPaletteItems(state({ cards }), actions()).map((i) => [i.id, i]));
    expect(byId.get("card-c1")).toMatchObject({ preview: "Built the login page", when: "5m ago" });
    expect(byId.get("card-c2")?.preview).toBe("Rate limited");
    expect(byId.get("card-c3")?.preview).toBeUndefined();
  });
});

describe("promptItems", () => {
  it("turns search hits into items for cards that still exist", () => {
    const card = makeCard({ id: "c1" });
    const openCard = vi.fn();
    const items = promptItems(
      [
        { cardId: "c1", snippet: "fix   the\nlogin" },
        { cardId: "gone", snippet: "x" },
      ],
      [card],
      () => "/root",
      openCard,
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: "prompt-c1-0", group: "Prompts", snippet: "fix the login", root: "/root" });
    items[0]?.run();
    expect(openCard).toHaveBeenCalledWith(card);
  });
});
