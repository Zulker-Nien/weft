import { describe, expect, it } from "vitest";
import { THREAD_PAGE_SIZE, TOOL_RESULT_INLINE_MAX } from "./cloud-sync-types";
import { applyThreadEvent, findToolResult, mergeOlderPage, pageThread, trimToolResult } from "./thread-page";
import type { ThreadItem } from "./types";

// Tests for pageThread: the newest page when before is unset, walking back with before, the
// default size, the limit cap, and the defensive clamps for weird input.

function items(n: number): ThreadItem[] {
  return Array.from({ length: n }, (_, i): ThreadItem => ({ kind: "user", text: `m${i}`, at: i }));
}

describe("pageThread", () => {
  it("returns the newest page (the last THREAD_PAGE_SIZE items) when before is unset", () => {
    const all = items(120);
    const page = pageThread(all);
    expect(page.start).toBe(120 - THREAD_PAGE_SIZE);
    expect(page.items.length).toBe(THREAD_PAGE_SIZE);
    expect(page.items[0]).toEqual({ kind: "user", text: "m70", at: 70 });
    expect(page.items[page.items.length - 1]).toEqual({ kind: "user", text: "m119", at: 119 });
    expect(page.total).toBe(120);
  });

  it("returns the whole thread when it fits in the page", () => {
    const all = items(10);
    const page = pageThread(all);
    expect(page).toEqual({ items: all, start: 0, total: 10 });
  });

  it("returns an empty page for an empty thread", () => {
    expect(pageThread([])).toEqual({ items: [], start: 0, total: 0 });
  });

  it("walks back from `before`, capped at `limit`", () => {
    const all = items(120);
    const page = pageThread(all, { before: 100, limit: 25 });
    expect(page.start).toBe(75);
    expect(page.items.length).toBe(25);
    expect(page.items[0]).toEqual({ kind: "user", text: "m75", at: 75 });
    expect(page.items[24]).toEqual({ kind: "user", text: "m99", at: 99 });
  });

  it("clamps `before` past the start of the thread", () => {
    const all = items(50);
    const page = pageThread(all, { before: 5, limit: 25 });
    expect(page.start).toBe(0);
    expect(page.items.length).toBe(5);
    expect(page.items[0]).toEqual({ kind: "user", text: "m0", at: 0 });
  });

  it("clamps `before` past the end of the thread to the newest page", () => {
    const all = items(50);
    const page = pageThread(all, { before: 500, limit: 25 });
    expect(page.start).toBe(25);
    expect(page.items.length).toBe(25);
  });

  it("clamps negative `before` to 0", () => {
    const all = items(50);
    const page = pageThread(all, { before: -1, limit: 25 });
    expect(page.start).toBe(0);
    expect(page.items.length).toBe(0);
  });

  it("uses THREAD_PAGE_SIZE when limit is unset, missing, or non-positive", () => {
    const all = items(THREAD_PAGE_SIZE * 2);
    expect(pageThread(all, { before: 50 }).items.length).toBe(THREAD_PAGE_SIZE);
    expect(pageThread(all, { limit: 0 }).items.length).toBe(THREAD_PAGE_SIZE);
    expect(pageThread(all, { limit: -5 }).items.length).toBe(THREAD_PAGE_SIZE);
  });

  it("falls back to THREAD_PAGE_SIZE for non-finite limits (NaN, Infinity)", () => {
    const all = items(THREAD_PAGE_SIZE * 2);
    expect(pageThread(all, { limit: Number.NaN }).items.length).toBe(THREAD_PAGE_SIZE);
    expect(pageThread(all, { limit: Number.POSITIVE_INFINITY }).items.length).toBe(THREAD_PAGE_SIZE);
  });

  it("floors a fractional limit", () => {
    const all = items(50);
    const page = pageThread(all, { limit: 10.7 });
    expect(page.items.length).toBe(10);
  });
});

// Tests for trimToolResult: pass through everything except a tool item with a result longer than
// the inline cap (whose result is dropped and resultBytes set).

function toolItem(overrides: Partial<Extract<ThreadItem, { kind: "tool" }>> = {}): ThreadItem {
  return { kind: "tool", id: "t1", name: "Bash", summary: "ls", result: "ok", at: 1, ...overrides };
}

describe("trimToolResult", () => {
  it("passes through non-tool items unchanged", () => {
    const u: ThreadItem = { kind: "user", text: "hi", at: 1 };
    expect(trimToolResult(u)).toBe(u);
    const a: ThreadItem = { kind: "assistant", text: "hello", at: 2 };
    expect(trimToolResult(a)).toBe(a);
    const r: ThreadItem = { kind: "result", text: "done", isError: false, at: 3 };
    expect(trimToolResult(r)).toBe(r);
  });

  it("passes a tool item through when it has no result", () => {
    const t = toolItem({ result: undefined });
    expect(trimToolResult(t)).toBe(t);
  });

  it("passes a tool item through when its result fits the inline cap", () => {
    const t = toolItem({ result: "x".repeat(TOOL_RESULT_INLINE_MAX) });
    expect(trimToolResult(t)).toBe(t);
  });

  it("drops a too-long result and sets resultBytes", () => {
    const big = "x".repeat(TOOL_RESULT_INLINE_MAX + 1);
    const t = toolItem({ result: big });
    const trimmed = trimToolResult(t);
    expect(trimmed).not.toBe(t);
    expect(trimmed.kind).toBe("tool");
    if (trimmed.kind === "tool") {
      expect(trimmed.result).toBeUndefined();
      expect(trimmed.resultBytes).toBe(big.length);
      expect(trimmed.id).toBe("t1");
      expect(trimmed.name).toBe("Bash");
      expect(trimmed.summary).toBe("ls");
    }
  });
});

// Tests for findToolResult: a top-level tool with the right id, a tool inside an "edited" fold,
// the id not matching, no result, and a tool result nested deep in the right place.

describe("findToolResult", () => {
  it("finds a top-level tool result by id", () => {
    const all: ThreadItem[] = [
      { kind: "user", text: "hi", at: 1 },
      toolItem({ id: "a", result: "alpha" }),
      toolItem({ id: "b", result: "beta" }),
    ];
    expect(findToolResult(all, "a")).toBe("alpha");
    expect(findToolResult(all, "b")).toBe("beta");
  });

  it("finds a tool result nested in an `edited` fold", () => {
    const folded: ThreadItem = {
      kind: "edited",
      items: [
        { kind: "user", text: "old", at: 1 },
        toolItem({ id: "x", result: "inside-fold" }),
      ],
      at: 2,
    };
    expect(findToolResult([folded], "x")).toBe("inside-fold");
  });

  it("returns undefined when the id is not present anywhere", () => {
    const all: ThreadItem[] = [
      toolItem({ id: "a", result: "alpha" }),
      { kind: "edited", items: [toolItem({ id: "b", result: "beta" })], at: 1 },
    ];
    expect(findToolResult(all, "missing")).toBeUndefined();
  });

  it("returns undefined when a matching tool has no result", () => {
    const all: ThreadItem[] = [toolItem({ id: "a", result: undefined })];
    expect(findToolResult(all, "a")).toBeUndefined();
  });

  it("returns undefined on an empty thread", () => {
    expect(findToolResult([], "a")).toBeUndefined();
  });

  it("ignores non-tool items at the top level and inside folds", () => {
    const all: ThreadItem[] = [
      { kind: "user", text: "hi", at: 1 },
      { kind: "permission", id: "a", toolName: "Bash", title: "go", at: 2 },
      { kind: "edited", items: [{ kind: "assistant", text: "no", at: 3 }], at: 4 },
    ];
    expect(findToolResult(all, "a")).toBeUndefined();
  });
});

describe("applyThreadEvent", () => {
  const window = () => pageThread(items(10), { before: 8, limit: 4 }); // m4..m7, start 4, total 10
  const item = (text: string): ThreadItem => ({ kind: "assistant", text, at: 99 });

  it("appends at the end of the window and replaces in place, by absolute index", () => {
    const appended = applyThreadEvent(pageThread(items(3)), { index: 3, item: item("new") });
    expect(appended.items.map((i) => (i.kind === "user" || i.kind === "assistant" ? i.text : ""))).toEqual(["m0", "m1", "m2", "new"]);
    expect(appended.total).toBe(4);
    const replaced = applyThreadEvent(window(), { index: 5, item: item("x") });
    expect(replaced.items[1]).toEqual(item("x"));
    expect(replaced.start).toBe(4);
    expect(replaced.total).toBe(10);
  });

  it("only bumps total for an event outside the window", () => {
    expect(applyThreadEvent(window(), { index: 2, item: item("above") })).toEqual({ ...window(), total: 10 });
    expect(applyThreadEvent(window(), { index: 20, item: item("far") })).toEqual({ ...window(), total: 21 });
  });

  it("a truncate puts the folded item at its index and drops what follows", () => {
    const next = applyThreadEvent(window(), { index: 6, item: item("folded"), truncate: true });
    expect(next.items).toEqual([...window().items.slice(0, 2), item("folded")]);
    expect(next).toMatchObject({ start: 4, total: 7 });
  });

  it("a truncate above the window folds the whole window into one item", () => {
    expect(applyThreadEvent(window(), { index: 1, item: item("folded"), truncate: true })).toEqual({ items: [item("folded")], start: 1, total: 2 });
  });
});

describe("mergeOlderPage", () => {
  it("prepends the older page and adopts its start", () => {
    const all = items(10);
    const newest = pageThread(all, { limit: 4 });
    const merged = mergeOlderPage(newest, pageThread(all, { before: newest.start, limit: 4 }));
    expect(merged).toEqual({ items: all.slice(2), start: 2, total: 10 });
  });

  it("skips items the window already holds when the pages overlap", () => {
    const all = items(10);
    const merged = mergeOlderPage(pageThread(all, { limit: 4 }), pageThread(all, { before: 8, limit: 4 }));
    expect(merged).toEqual({ items: all.slice(4), start: 4, total: 10 });
  });
});
