import { execFileSync } from "node:child_process";

// A folder's git branch and its uncommitted line counts, for a card's status strip after each turn.

export function gitBranch(cwd: string) {
  try {
    return execFileSync("git", ["-C", cwd, "--no-optional-locks", "rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8", timeout: 3000 }).trim() || undefined;
  } catch {
    return undefined;
  }
}

export function changedLines(cwd: string) {
  try {
    const out = execFileSync("git", ["-C", cwd, "--no-optional-locks", "diff", "HEAD", "--numstat"], { encoding: "utf8", timeout: 3000 });
    let added = 0;
    let removed = 0;
    for (const line of out.split("\n")) {
      const [a, r] = line.split("\t");
      added += Number(a) || 0;
      removed += Number(r) || 0;
    }
    return { added, removed };
  } catch {
    return { added: undefined, removed: undefined };
  }
}