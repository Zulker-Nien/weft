import { execFileSync } from "node:child_process";
import path from "node:path";
import type { TouchedFile } from "./handoff";

// The uncommitted diff of the files a thread changed, for the brief a fresh session starts from (lib/splice.ts).
// Cards share one working tree, so another card's edits can sit in the same file: where this thread's edits
// named their symbols, only the hunks that mention one are kept. Past the cap it falls back to a --stat list,
// and the fresh session can run `git diff` itself.

// About 8k tokens.
export const DIFF_CAP = 32_000;

export type Git = (args: string[], cwd: string) => string;

const git: Git = (args, cwd) => execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 8 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });

// One file's diff with only the hunks that mention one of `symbols`; all of it when none do (a symbol renamed
// away, say) or when the edits named none.
export function scopeHunks(diff: string, symbols: string[]): string {
  if (!symbols.length) return diff;
  const [head = "", ...hunks] = diff.split(/^(?=@@ )/m);
  const kept = hunks.filter((hunk) => symbols.some((s) => hunk.includes(s)));
  return kept.length ? head + kept.join("") : diff;
}

function fileDiff(file: TouchedFile, cwd: string, run: Git): string {
  const full = path.resolve(cwd, file.file);
  try {
    return scopeHunks(run(["diff", "HEAD", "--", full], cwd), file.symbols);
  } catch {
    // Outside a repo, or outside this one.
    return "";
  }
}

// The scoped diff, or a --stat list when it's over the cap, or "" when nothing differs from HEAD.
export function scopedDiff(cwd: string, files: TouchedFile[], run: Git = git): string {
  const diff = files.map((f) => fileDiff(f, cwd, run)).filter(Boolean).join("");
  if (diff.length <= DIFF_CAP) return diff.trim();
  try {
    const stat = run(["diff", "HEAD", "--stat", "--", ...files.map((f) => path.resolve(cwd, f.file))], cwd).trim();
    return `${stat}\n\n(The full diff is over ${DIFF_CAP / 1000}k characters; run git diff on these files to read it.)`;
  } catch {
    return "";
  }
}
