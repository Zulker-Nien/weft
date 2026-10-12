import { beforeEach, describe, expect, it, vi } from "vitest";
import { changedLines, gitBranch } from "./git-stats";

const git = vi.hoisted(() => ({ out: "", fails: false }));
vi.mock("node:child_process", () => {
  const execFileSync = () => {
    if (git.fails) throw new Error("not a git repo");
    return git.out;
  };
  return { default: { execFileSync }, execFileSync };
});

beforeEach(() => {
  git.out = "";
  git.fails = false;
});

describe("gitBranch", () => {
  it("reads the branch, and nothing for empty output or a folder outside git", () => {
    git.out = "main\n";
    expect(gitBranch("/repo")).toBe("main");
    git.out = "\n";
    expect(gitBranch("/repo")).toBeUndefined();
    git.fails = true;
    expect(gitBranch("/repo")).toBeUndefined();
  });
});

describe("changedLines", () => {
  it("adds up the numstat, counting binary files (-) as nothing", () => {
    git.out = "3\t1\ta.ts\n-\t-\timg.png\n2\t0\tb.ts\n";
    expect(changedLines("/repo")).toEqual({ added: 5, removed: 1 });
    git.fails = true;
    expect(changedLines("/repo")).toEqual({ added: undefined, removed: undefined });
  });
});
