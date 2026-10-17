// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  TABS_STORAGE_KEY,
  allowedModes,
  closeTab,
  defaultMode,
  fileName,
  isMarkdownPath,
  loadTabs,
  normalizePath,
  openTab,
  saveTabs,
  setActive,
  setMode,
  type EditorTabsState,
} from "./editor-tabs";

function empty(): EditorTabsState {
  return { tabs: [], activePath: null };
}

beforeEach(() => {
  localStorage.clear();
});

describe("isMarkdownPath / allowedModes / defaultMode", () => {
  it("treats md, mdx, markdown as markdown", () => {
    expect(isMarkdownPath("README.md")).toBe(true);
    expect(isMarkdownPath("docs/page.MD")).toBe(true);
    expect(isMarkdownPath("x.mdx")).toBe(true);
    expect(isMarkdownPath("notes.markdown")).toBe(true);
    expect(isMarkdownPath("x.ts")).toBe(false);
    expect(isMarkdownPath("md")).toBe(false);
  });

  it("lets markdown toggle between edit and source", () => {
    expect(allowedModes("a.md")).toEqual(["edit", "source"]);
  });

  it("gives code files edit and changes", () => {
    expect(allowedModes("a.ts")).toEqual(["edit", "changes"]);
  });

  it("has a default mode", () => {
    expect(defaultMode("a.ts")).toBe("edit");
    expect(defaultMode("a.md")).toBe("edit");
  });
});

describe("normalizePath", () => {
  const cwd = "/Users/me/app";

  it("keeps a clean relative path", () => {
    expect(normalizePath("lib/x.ts", cwd)).toBe("lib/x.ts");
  });

  it("rejects a relative path that walks out", () => {
    expect(normalizePath("../oops.ts", cwd)).toBeNull();
    expect(normalizePath("a/../../oops.ts", cwd)).toBeNull();
  });

  it("accepts the exact cwd", () => {
    expect(normalizePath(cwd, cwd)).toBe("");
  });

  it("accepts an absolute path inside cwd", () => {
    expect(normalizePath(`${cwd}/lib/x.ts`, cwd)).toBe("lib/x.ts");
  });

  it("refuses an absolute path outside cwd", () => {
    expect(normalizePath("/Users/other/x.ts", cwd)).toBeNull();
    expect(normalizePath("/Users/me/appe/x.ts", cwd)).toBeNull();
  });

  it("rejects empty or non-string-ish inputs", () => {
    expect(normalizePath("", cwd)).toBeNull();
  });
});

describe("openTab", () => {
  const cwd = "/Users/me/app";

  it("adds a new tab and makes it active", () => {
    const next = openTab(empty(), "lib/x.ts", cwd);
    expect(next.tabs).toEqual([{ path: "lib/x.ts", mode: "edit" }]);
    expect(next.activePath).toBe("lib/x.ts");
  });

  it("dedupes by exact path", () => {
    const a = openTab(empty(), "lib/x.ts", cwd);
    const b = openTab(a, "lib/x.ts", cwd);
    expect(b.tabs).toHaveLength(1);
    expect(b.activePath).toBe("lib/x.ts");
  });

  it("dedupes after normalization (absolute becomes relative)", () => {
    const a = openTab(empty(), "lib/x.ts", cwd);
    const b = openTab(a, `${cwd}/lib/x.ts`, cwd);
    expect(b.tabs).toHaveLength(1);
    expect(b.tabs[0]?.path).toBe("lib/x.ts");
  });

  it("refuses to open a path that escapes cwd", () => {
    const next = openTab(empty(), "/etc/hosts", cwd);
    expect(next).toEqual(empty());
  });

  it("keeps the previously active tab when opening a second one", () => {
    const a = openTab(empty(), "a.ts", cwd);
    const b = openTab(a, "b.ts", cwd);
    expect(b.tabs.map((t) => t.path)).toEqual(["a.ts", "b.ts"]);
    expect(b.activePath).toBe("b.ts");
  });
});

describe("setActive / closeTab / setMode", () => {
  const cwd = "/Users/me/app";
  const a = openTab(openTab(empty(), "a.ts", cwd), "b.ts", cwd);

  it("setActive moves focus", () => {
    const next = setActive(a, "a.ts");
    expect(next.activePath).toBe("a.ts");
  });

  it("setActive ignores an unknown path", () => {
    const next = setActive(a, "nope.ts");
    expect(next.activePath).toBe(a.activePath);
  });

  it("closeTab removes a tab and shifts active to the remaining one", () => {
    const next = closeTab(a, "b.ts");
    expect(next.tabs.map((t) => t.path)).toEqual(["a.ts"]);
    expect(next.activePath).toBe("a.ts");
  });

  it("closeTab on the only tab clears active", () => {
    const only = openTab(empty(), "a.ts", cwd);
    const next = closeTab(only, "a.ts");
    expect(next.tabs).toEqual([]);
    expect(next.activePath).toBeNull();
  });

  it("setMode changes a tab's mode when allowed", () => {
    const next = setMode(a, "a.ts", "changes");
    expect(next.tabs.find((t) => t.path === "a.ts")?.mode).toBe("changes");
  });

  it("setMode clamps markdown to edit or source", () => {
    const md = openTab(empty(), "x.md", cwd);
    const withChanges = setMode(md, "x.md", "changes");
    expect(withChanges.tabs[0]?.mode).toBe("edit");
    const withSource = setMode(md, "x.md", "source");
    expect(withSource.tabs[0]?.mode).toBe("source");
  });

  it("setMode is a no-op for an unknown tab", () => {
    const next = setMode(a, "nope.ts", "changes");
    expect(next).toBe(a);
  });
});

describe("loadTabs / saveTabs", () => {
  const cardId = "c1";

  it("returns empty when nothing is stored", () => {
    expect(loadTabs(cardId)).toEqual(empty());
  });

  it("round-trips through localStorage", () => {
    const state: EditorTabsState = { tabs: [{ path: "a.ts", mode: "changes" }, { path: "b.md", mode: "source" }], activePath: "b.md" };
    saveTabs(cardId, state);
    expect(loadTabs(cardId)).toEqual(state);
  });

  it("drops invalid stored entries", () => {
    localStorage.setItem(TABS_STORAGE_KEY(cardId), JSON.stringify({ tabs: [{ path: "", mode: "edit" }, { path: "a.ts", mode: "bogus" }], activePath: "missing" }));
    expect(loadTabs(cardId)).toEqual(empty());
  });

  it("clamps a stored mode that isn't allowed for the path", () => {
    localStorage.setItem(TABS_STORAGE_KEY(cardId), JSON.stringify({ tabs: [{ path: "a.ts", mode: "source" }], activePath: "a.ts" }));
    const loaded = loadTabs(cardId);
    expect(loaded.tabs[0]?.mode).toBe("edit");
  });

  it("falls back to the first tab when activePath is gone", () => {
    localStorage.setItem(TABS_STORAGE_KEY(cardId), JSON.stringify({ tabs: [{ path: "a.ts", mode: "edit" }], activePath: "missing" }));
    const loaded = loadTabs(cardId);
    expect(loaded.activePath).toBe("a.ts");
  });

  it("returns empty on a corrupt JSON blob", () => {
    localStorage.setItem(TABS_STORAGE_KEY(cardId), "{not json");
    expect(loadTabs(cardId)).toEqual(empty());
  });

  it("saveTabs is a no-op when localStorage throws", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    try {
      expect(() => saveTabs(cardId, { tabs: [{ path: "a.ts", mode: "edit" }], activePath: "a.ts" })).not.toThrow();
    } finally {
      setItem.mockRestore();
    }
  });
});

describe("fileName", () => {
  it("takes the last segment", () => {
    expect(fileName("lib/foo/bar.ts")).toBe("bar.ts");
    expect(fileName("a.ts")).toBe("a.ts");
  });
});
