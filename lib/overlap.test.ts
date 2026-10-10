import { describe, expect, it } from "vitest";
import { alsoHereLine, busyHere, busyInFolder, isBusy, sameTree } from "./overlap";
import type { Card } from "./types";

let seq = 0;
function card(overrides: Partial<Card> = {}): Card {
  seq += 1;
  return {
    id: `c${seq}`,
    title: `Card ${seq}`,
    prompt: "do it",
    cwd: "/repo",
    backend: "claude",
    permissionMode: "default",
    column: "running",
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe("sameTree", () => {
  it("matches the same folder, ignoring trailing slashes", () => {
    expect(sameTree("/me/app", "/me/app/")).toBe(true);
  });

  it("matches a folder inside the other, either way round", () => {
    expect(sameTree("/me/app/src", "/me/app")).toBe(true);
    expect(sameTree("/me/app", "/me/app/src")).toBe(true);
  });

  it("does not match siblings or a shared name prefix", () => {
    expect(sameTree("/me/app", "/me/other")).toBe(false);
    expect(sameTree("/me/app", "/me/app-two")).toBe(false);
  });

  it("keeps a Claude Code worktree apart from its repo and from other worktrees", () => {
    expect(sameTree("/me/app/.claude/worktrees/x", "/me/app")).toBe(false);
    expect(sameTree("/me/app/.claude/worktrees/x", "/me/app/.claude/worktrees/y")).toBe(false);
    expect(sameTree("/me/app/.claude/worktrees/x/src", "/me/app/.claude/worktrees/x")).toBe(true);
  });
});

describe("isBusy", () => {
  it("counts running and needs-you cards, not archived ones or the copilot", () => {
    expect(isBusy(card({ column: "running" }))).toBe(true);
    expect(isBusy(card({ column: "needs_you" }))).toBe(true);
    expect(isBusy(card({ column: "review" }))).toBe(false);
    expect(isBusy(card({ column: "backlog" }))).toBe(false);
    expect(isBusy(card({ column: "running", archived: true }))).toBe(false);
    expect(isBusy(card({ column: "running", role: "copilot" }))).toBe(false);
  });
});

describe("busyHere", () => {
  it("lists the other busy cards in the card's folder", () => {
    const me = card({ cwd: "/repo", column: "review" });
    const sub = card({ cwd: "/repo/web" });
    const waiting = card({ cwd: "/repo/", column: "needs_you" });
    const idle = card({ cwd: "/repo", column: "done" });
    const elsewhere = card({ cwd: "/other" });
    expect(busyHere([me, sub, waiting, idle, elsewhere], me)).toEqual([sub, waiting]);
  });

  it("leaves the card itself out", () => {
    const me = card();
    expect(busyHere([me], me)).toEqual([]);
  });

  it("checks a folder before any card exists", () => {
    const busy = card({ cwd: "/repo" });
    expect(busyInFolder([busy], "/repo/src")).toEqual([busy]);
  });
});

describe("alsoHereLine", () => {
  it("names the first card and counts the rest", () => {
    expect(alsoHereLine([])).toBe("");
    expect(alsoHereLine([card({ title: "Fix login" })])).toBe("Also running here: Fix login");
    expect(alsoHereLine([card({ title: "Fix login" }), card(), card()])).toBe("Also running here: Fix login and 2 more");
  });
});
