import { describe, expect, it, vi } from "vitest";
import { DIFF_CAP, scopedDiff, scopeHunks, type Git } from "./splice-diff";

const file = (name: string, symbols: string[] = []) => ({ file: name, edits: 1, added: 1, removed: 0, symbols });

const DIFF = [
  "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n",
  "@@ -1,2 +1,3 @@ function login\n+mine\n",
  "@@ -9,2 +10,3 @@ function other\n+theirs\n",
].join("");

describe("scopeHunks", () => {
  it("keeps the header and the hunks that name one of the symbols", () => {
    expect(scopeHunks(DIFF, ["login"])).toBe(DIFF.replace("@@ -9,2 +10,3 @@ function other\n+theirs\n", ""));
  });

  it("keeps everything when no symbols were named, or none match", () => {
    expect(scopeHunks(DIFF, [])).toBe(DIFF);
    expect(scopeHunks(DIFF, ["gone"])).toBe(DIFF);
  });
});

describe("scopedDiff", () => {
  it("joins each touched file's scoped diff, run in the card's folder", () => {
    const run = vi.fn<Git>((args) => (args.at(-1) === "/p/a.ts" ? DIFF : ""));
    expect(scopedDiff("/p", [file("a.ts", ["login"]), file("b.ts")], run)).not.toContain("theirs");
    expect(run).toHaveBeenCalledWith(["diff", "HEAD", "--", "/p/a.ts"], "/p");
  });

  it("skips a file git can't diff", () => {
    const run = vi.fn<Git>(() => {
      throw new Error("not a repo");
    });
    expect(scopedDiff("/p", [file("a.ts")], run)).toBe("");
  });

  it("falls back to --stat over the cap, or to nothing when that fails too", () => {
    const big = "x".repeat(DIFF_CAP + 1);
    const run = vi.fn<Git>((args) => (args.includes("--stat") ? " a.ts | 900 +++\n" : big));
    expect(scopedDiff("/p", [file("a.ts")], run)).toMatch(/^a\.ts \| 900 \+\+\+\n\n\(The full diff is over 32k/);
    const failing = vi.fn<Git>((args) => {
      if (args.includes("--stat")) throw new Error("boom");
      return big;
    });
    expect(scopedDiff("/p", [file("a.ts")], failing)).toBe("");
  });
});
