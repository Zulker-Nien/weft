// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { filesApi } = vi.hoisted(() => ({
  filesApi: { read: vi.fn(), stat: vi.fn(), head: vi.fn(), list: vi.fn(), write: vi.fn() },
}));

vi.mock("@/lib/client-files", () => ({ filesApi }));

import { useEditorColumn } from "./use-editor-column";
import { drainOpenFiles, openFile } from "./open-file";

const cardId = "card-1";
const cwd = "/Users/me/app";

beforeEach(() => {
  localStorage.clear();
  // The open-file queue is module-level; drain every card we've used.
  drainOpenFiles(cardId);
  drainOpenFiles("other");
  vi.clearAllMocks();
  filesApi.head.mockResolvedValue("head version");
});

afterEach(cleanup);

describe("useEditorColumn — initial state", () => {
  it("starts empty when no tabs are stored and no requests are queued", () => {
    const { result } = renderHook(() => useEditorColumn(cardId, cwd));
    expect(result.current.tabs).toEqual([]);
    expect(result.current.activeTab).toBeNull();
    expect(result.current.openQuick).toBe(false);
  });

  it("drains queued open-file requests on mount and makes the last one active", () => {
    openFile({ cardId, path: "lib/y.ts" });
    openFile({ cardId, path: "lib/z.ts" });
    const { result } = renderHook(() => useEditorColumn(cardId, cwd));
    expect(result.current.tabs.map((t) => t.path)).toEqual(["lib/y.ts", "lib/z.ts"]);
    expect(result.current.activeTab?.path).toBe("lib/z.ts");
    // The queue is drained; subsequent events would still fire the listener.
    expect(drainOpenFiles(cardId)).toEqual([]);
  });

  it("ignores queued requests for other cards", () => {
    openFile({ cardId: "other", path: "lib/x.ts" });
    const { result } = renderHook(() => useEditorColumn(cardId, cwd));
    expect(result.current.tabs).toEqual([]);
  });

  it("ignores paths that escape cwd", () => {
    openFile({ cardId, path: "/etc/hosts" });
    const { result } = renderHook(() => useEditorColumn(cardId, cwd));
    expect(result.current.tabs).toEqual([]);
  });
});

describe("useEditorColumn — live open events", () => {
  it("opens a new tab when openFile fires for this card after mount", () => {
    const { result } = renderHook(() => useEditorColumn(cardId, cwd));
    act(() => {
      openFile({ cardId, path: "lib/a.ts" });
    });
    expect(result.current.activeTab?.path).toBe("lib/a.ts");
  });

  it("opens a code tab in Changes mode when the request asks for it", () => {
    const { result } = renderHook(() => useEditorColumn(cardId, cwd));
    act(() => {
      openFile({ cardId, path: "lib/a.ts", diff: true });
    });
    expect(result.current.activeTab?.path).toBe("lib/a.ts");
    expect(result.current.activeTab?.mode).toBe("changes");
  });

  it("ignores openFile for other cards", () => {
    const { result } = renderHook(() => useEditorColumn(cardId, cwd));
    act(() => {
      openFile({ cardId: "other", path: "lib/a.ts" });
    });
    expect(result.current.tabs).toEqual([]);
  });
});

describe("useEditorColumn — tab actions", () => {
  it("setActive moves focus", () => {
    openFile({ cardId, path: "lib/a.ts" });
    openFile({ cardId, path: "lib/b.ts" });
    const { result } = renderHook(() => useEditorColumn(cardId, cwd));
    expect(result.current.activeTab?.path).toBe("lib/b.ts");
    act(() => result.current.setActive("lib/a.ts"));
    expect(result.current.activeTab?.path).toBe("lib/a.ts");
  });

  it("close removes the tab and shifts active to the remaining one", () => {
    openFile({ cardId, path: "lib/a.ts" });
    openFile({ cardId, path: "lib/b.ts" });
    const { result } = renderHook(() => useEditorColumn(cardId, cwd));
    act(() => result.current.close("lib/b.ts"));
    expect(result.current.tabs.map((t) => t.path)).toEqual(["lib/a.ts"]);
    expect(result.current.activeTab?.path).toBe("lib/a.ts");
  });

  it("setMode changes the active tab's mode when allowed", () => {
    openFile({ cardId, path: "lib/a.ts" });
    const { result } = renderHook(() => useEditorColumn(cardId, cwd));
    act(() => result.current.setMode("lib/a.ts", "changes"));
    expect(result.current.activeTab?.mode).toBe("changes");
  });

  it("setMode refuses to mark a code file as source", () => {
    openFile({ cardId, path: "lib/a.ts" });
    const { result } = renderHook(() => useEditorColumn(cardId, cwd));
    act(() => result.current.setMode("lib/a.ts", "source"));
    expect(result.current.activeTab?.mode).toBe("edit");
  });
});

describe("useEditorColumn — quick open", () => {
  it("showQuickOpen / hideQuickOpen toggle the overlay", () => {
    const { result } = renderHook(() => useEditorColumn(cardId, cwd));
    expect(result.current.openQuick).toBe(false);
    act(() => result.current.showQuickOpen());
    expect(result.current.openQuick).toBe(true);
    act(() => result.current.hideQuickOpen());
    expect(result.current.openQuick).toBe(false);
  });
});

describe("useEditorColumn — persistence", () => {
  it("persists tabs to localStorage when a request is drained on mount", () => {
    openFile({ cardId, path: "lib/a.ts" });
    renderHook(() => useEditorColumn(cardId, cwd));
    const stored = localStorage.getItem(`weft-editor-tabs:${cardId}`);
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored as string) as { tabs: { path: string }[] };
    expect(parsed.tabs.map((t) => t.path)).toContain("lib/a.ts");
  });
});

describe("useEditorColumn — head text", () => {
  it("fetches the head text when a code tab enters changes mode", async () => {
    openFile({ cardId, path: "lib/a.ts", diff: true });
    const { result } = renderHook(() => useEditorColumn(cardId, cwd));
    await vi.waitFor(() => expect(filesApi.head).toHaveBeenCalledWith(cardId, "lib/a.ts"));
    await vi.waitFor(() => expect(result.current.head).toBe("head version"));
    expect(result.current.headLoaded).toBe(true);
    expect(result.current.headLoading).toBe(false);
  });

  it("doesn't fetch the head text for markdown files in changes mode", () => {
    openFile({ cardId, path: "README.md", diff: true });
    renderHook(() => useEditorColumn(cardId, cwd));
    // Markdown's `changes` falls back to `edit` (not a real mode), so no head fetch.
    expect(filesApi.head).not.toHaveBeenCalled();
  });
});

describe("useEditorColumn — mdBaselineRef", () => {
  it("captures the first md passed to onMdChange and resets on path change", () => {
    const { result, rerender } = renderHook(() => useEditorColumn(cardId, cwd));
    act(() => result.current.onMdChange("first"));
    expect(result.current.mdBaselineRef.current).toBe("first");
    act(() => result.current.onMdChange("second"));
    // The baseline is only captured the first time, so it stays "first".
    expect(result.current.mdBaselineRef.current).toBe("first");
    // Opening a different file resets the baseline.
    act(() => {
      openFile({ cardId, path: "lib/a.md" });
    });
    rerender();
    expect(result.current.mdBaselineRef.current).toBe("");
  });
});
