// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { columnCounts, loadSeen, markSeen, nextTip, resetTips, tipById, TIPS_KEY } from "./tips";

function memory(initial?: string) {
  const data = new Map<string, string>(initial === undefined ? [] : [[TIPS_KEY, initial]]);
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    data,
  };
}

describe("nextTip", () => {
  it("shows nothing on an empty board", () => {
    expect(nextTip({}, new Set())).toBeNull();
  });

  it("goes in order: needs-you, review, done, profile", () => {
    const all = { needs_you: 1, review: 1, done: 0 };
    expect(nextTip(all, new Set())).toBe("needs-you");
    expect(nextTip(all, new Set(["needs-you"]))).toBe("review");
    expect(nextTip(all, new Set(["needs-you", "review"]))).toBe("done");
    expect(nextTip(all, new Set(["needs-you", "review", "done"]))).toBeNull();
  });

  it("skips a tip whose column is empty", () => {
    expect(nextTip({ review: 2 }, new Set())).toBe("review");
    expect(nextTip({ done: 1 }, new Set())).toBe("profile");
  });

  it("asks for Done only while Done is empty", () => {
    expect(nextTip({ review: 1, done: 3 }, new Set(["review"]))).toBe("profile");
  });
});

describe("seen set", () => {
  it("loads nothing from empty, broken or odd storage", () => {
    expect(loadSeen(memory()).size).toBe(0);
    expect(loadSeen(memory("{bad")).size).toBe(0);
    expect(loadSeen(memory('{"a":1}')).size).toBe(0);
    expect([...loadSeen(memory('["review", 3, "nope"]'))]).toEqual(["review"]);
    expect(loadSeen(null).size).toBe(0);
  });

  it("marks, persists and resets", () => {
    const s = memory();
    expect([...markSeen("done", s)]).toEqual(["done"]);
    expect([...markSeen("review", s)].sort()).toEqual(["done", "review"]);
    expect(loadSeen(s).has("review")).toBe(true);
    resetTips(s);
    expect(s.data.has(TIPS_KEY)).toBe(false);
  });

  it("survives storage that throws", () => {
    const bad = {
      getItem: () => null,
      setItem: () => {
        throw new Error("full");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect([...markSeen("profile", bad)]).toEqual(["profile"]);
    expect(() => resetTips(bad)).not.toThrow();
    expect(markSeen("review", null).has("review")).toBe(true);
    expect(() => resetTips(null)).not.toThrow();
  });

  it("defaults to localStorage, and to nothing when it's blocked", () => {
    localStorage.clear();
    markSeen("needs-you");
    expect(loadSeen().has("needs-you")).toBe(true);
    resetTips();
    expect(loadSeen().size).toBe(0);
    const spy = vi.spyOn(globalThis, "localStorage", "get").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(loadSeen().size).toBe(0);
    spy.mockImplementation(() => undefined as unknown as Storage);
    expect(loadSeen().size).toBe(0);
    spy.mockRestore();
  });
});

describe("columnCounts", () => {
  it("counts unarchived non-copilot cards per column", () => {
    expect(
      columnCounts([
        { column: "review" },
        { column: "review" },
        { column: "done", archived: true },
        { column: "needs_you", role: "copilot" },
        { column: "running" },
      ]),
    ).toEqual({ review: 2, running: 1 });
  });

  it("finds a tip by id", () => {
    expect(tipById("profile").action?.kind).toBe("profile");
  });
});
