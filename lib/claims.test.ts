import { describe, expect, it } from "vitest";
import { addClaims, claimKey, CLAIMS_CAP, clashes, clashQuestion, clashWhy, dropClaims, findClash, splitClaim } from "./claims";
import type { Card } from "./types";

let seq = 0;
function card(overrides: Partial<Card> = {}): Card {
  seq += 1;
  return { id: `c${seq}`, title: `Card ${seq}`, prompt: "", cwd: "/repo", backend: "claude", permissionMode: "default", column: "running", createdAt: 0, updatedAt: 0, ...overrides };
}

describe("claim keys", () => {
  it("joins a file and a symbol, the whole file by default, and splits them back", () => {
    expect(claimKey("/r/a.ts", "Panel")).toBe("/r/a.ts#Panel");
    expect(claimKey("/r/a.ts")).toBe("/r/a.ts#*");
    expect(splitClaim("/r/a.ts#Board/useEffect#3")).toEqual({ file: "/r/a.ts", symbol: "Board/useEffect#3" });
    expect(splitClaim("/r/a.ts#Board/return/div#2/main")).toEqual({ file: "/r/a.ts", symbol: "Board/return/div#2/main" });
  });

  it("escapes a # (and %) in the path, so the key's first # starts the symbol", () => {
    const key = claimKey("/r/#1 100%/a.ts", "Board/useEffect#3");
    expect(key).toBe("/r/%231 100%25/a.ts#Board/useEffect#3");
    expect(splitClaim(key)).toEqual({ file: "/r/#1 100%/a.ts", symbol: "Board/useEffect#3" });
  });
});

describe("clashes", () => {
  it("clashes on the same symbol or a whole-file claim, in the same file only", () => {
    expect(clashes("/a.ts#f", "/a.ts#f")).toBe(true);
    expect(clashes("/a.ts#f", "/a.ts#*")).toBe(true);
    expect(clashes("/a.ts#*", "/a.ts#g")).toBe(true);
    expect(clashes("/a.ts#f", "/a.ts#g")).toBe(false);
    expect(clashes("/a.ts#f", "/b.ts#f")).toBe(false);
  });

  it("clashes when one claim sits inside the other, not on a shared prefix alone", () => {
    expect(clashes("/a.tsx#Board", "/a.tsx#Board/useEffect#3")).toBe(true);
    expect(clashes("/a.tsx#Board/return/main/Item#4", "/a.tsx#Board/return")).toBe(true);
    expect(clashes("/a.tsx#Board/useEffect#3", "/a.tsx#Board/useEffect#2")).toBe(false);
    expect(clashes("/a.tsx#Board/moveFocus", "/a.tsx#Board/move")).toBe(false);
    expect(clashes("/a.tsx#Board/x", "/a.tsx#BoardView")).toBe(false);
  });
});

describe("addClaims", () => {
  it("puts new claims first, without repeats", () => {
    expect(addClaims(undefined, ["/a#f"])).toEqual(["/a#f"]);
    expect(addClaims(["/a#f", "/a#g"], ["/a#g"])).toEqual(["/a#g", "/a#f"]);
  });

  it("returns undefined when nothing changes", () => {
    expect(addClaims(["/a#f", "/a#g"], ["/a#f"])).toBeUndefined();
    expect(addClaims(undefined, [])).toBeUndefined();
  });

  it("keeps at most CLAIMS_CAP", () => {
    const many = Array.from({ length: CLAIMS_CAP }, (_, i) => `/a#s${i}`);
    const next = addClaims(many, ["/a#new"]);
    expect(next).toHaveLength(CLAIMS_CAP);
    expect(next?.[0]).toBe("/a#new");
  });
});

describe("dropClaims", () => {
  it("drops the claims on the given files, or returns undefined when it held none", () => {
    expect(dropClaims(["/a.ts#f", "/b.ts#*", "/a.ts#g"], new Set(["/a.ts"]))).toEqual(["/b.ts#*"]);
    expect(dropClaims(["/b.ts#*"], new Set(["/a.ts"]))).toBeUndefined();
    expect(dropClaims(undefined, new Set(["/a.ts"]))).toBeUndefined();
  });
});

describe("findClash", () => {
  it("finds another busy card in the same tree holding a clashing claim", () => {
    const me = card();
    const other = card({ title: "Fix login", claims: ["/repo/a.ts#g", "/repo/a.ts#f"] });
    expect(findClash([me, other], me, ["/repo/a.ts#f"])).toEqual({ card: other, theirs: "/repo/a.ts#f", mine: "/repo/a.ts#f" });
  });

  it("ignores the card itself, idle cards, other trees and other symbols", () => {
    const me = card({ claims: ["/repo/a.ts#f"] });
    const idle = card({ column: "review", claims: ["/repo/a.ts#f"] });
    const away = card({ cwd: "/other", claims: ["/repo/a.ts#f"] });
    const elsewhere = card({ claims: ["/repo/a.ts#g"] });
    const none = card();
    expect(findClash([me, idle, away, elsewhere, none], me, ["/repo/a.ts#f"])).toBeUndefined();
  });
});

describe("clashWhy", () => {
  it("files a clash under same code, overlapping code or whole file, and names the holder", () => {
    const running = card({ title: "Fix login", column: "running" });
    expect(clashWhy({ card: running, theirs: "/repo/Login.tsx#LoginForm", mine: "/repo/Login.tsx#LoginForm" })).toEqual({
      category: "same-code",
      detail: "‘Fix login’ (running) has uncommitted edits to LoginForm",
      holder: { id: running.id, title: "Fix login", claim: "/repo/Login.tsx#LoginForm" },
    });
    expect(clashWhy({ card: running, theirs: "/repo/B.tsx#Board/useEffect#3", mine: "/repo/B.tsx#Board" })).toMatchObject({
      category: "overlap",
      detail: "‘Fix login’ (running) has uncommitted edits to Board › useEffect #3",
    });
    const waiting = card({ title: "Restyle", column: "needs_you" });
    expect(clashWhy({ card: waiting, theirs: "/repo/app.css#*", mine: "/repo/app.css#x" })).toMatchObject({
      category: "whole-file",
      detail: "‘Restyle’ (waiting on you) has uncommitted edits to app.css",
    });
    expect(clashWhy({ card: waiting, theirs: "/repo/a.ts#one", mine: "/repo/a.ts#*" }).category).toBe("whole-file");
  });
});

describe("clashQuestion", () => {
  it("names the card, the symbol and the file", () => {
    const other = card({ title: "Fix login" });
    expect(clashQuestion({ card: other, theirs: "/repo/Login.tsx#LoginForm", mine: "/repo/Login.tsx#*" })).toBe("Card ‘Fix login’ is editing LoginForm in Login.tsx. Wait, or go ahead?");
  });

  it("names just the file for a whole-file claim", () => {
    const other = card({ title: "Restyle" });
    expect(clashQuestion({ card: other, theirs: "/repo/app.css#*", mine: "/repo/app.css#*" })).toBe("Card ‘Restyle’ is editing app.css. Wait, or go ahead?");
  });
});
