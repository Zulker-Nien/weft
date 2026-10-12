import { describe, expect, it } from "vitest";
import { canContinue, canRestart, CLOSED_LINE, resumeAllTargets } from "./card-resume";
import type { Card } from "./types";

describe("canContinue and canRestart", () => {
  const card = (over: Partial<Card> = {}): Card => ({
    id: "c", title: "t", prompt: "p", cwd: "/x", backend: "claude", permissionMode: "default",
    column: "review", lastLine: "All done", sessionId: "s", createdAt: 0, updatedAt: 0, ...over,
  });

  it("continues any idle card with a session, even one that finished or asked you something", () => {
    expect(canContinue(card())).toBe(true);
    expect(canContinue(card({ column: "needs_you", lastLine: "Should I go on?" }))).toBe(true);
    expect(canContinue(card({ column: "backlog", lastLine: "Stopped" }))).toBe(true);
  });

  it("doesn't continue a card with no session, running, waiting on a permission or login, Done, filed away or the copilot", () => {
    expect(canContinue(card({ sessionId: undefined }))).toBe(false);
    expect(canContinue(card({ column: "running" }))).toBe(false);
    expect(canContinue(card({ column: "needs_you", pending: { id: "p" } as Card["pending"] }))).toBe(false);
    expect(canContinue(card({ column: "needs_you", lastLine: "Log in to Claude Code to run this thread" }))).toBe(false);
    expect(canContinue(card({ column: "done" }))).toBe(false);
    expect(canContinue(card({ archived: true }))).toBe(false);
    expect(canContinue(card({ role: "copilot" }))).toBe(false);
  });

  it("restarts a stopped or failed card, with or without a session", () => {
    expect(canRestart(card({ lastLine: "Stopped" }))).toBe(true);
    expect(canRestart(card({ lastLine: CLOSED_LINE }))).toBe(true);
    expect(canRestart(card({ error: "API Error: 529", sessionId: undefined, column: "backlog" }))).toBe(true);
  });

  it("doesn't restart a card that finished, runs, waits on you, is Done, filed away or the copilot", () => {
    expect(canRestart(card())).toBe(false);
    expect(canRestart(card({ lastLine: "Stopped", column: "running" }))).toBe(false);
    expect(canRestart(card({ error: "Not logged in", column: "needs_you" }))).toBe(false);
    expect(canRestart(card({ lastLine: "Stopped", pending: { id: "p" } as Card["pending"] }))).toBe(false);
    expect(canRestart(card({ lastLine: "Stopped", column: "done" }))).toBe(false);
    expect(canRestart(card({ lastLine: "Stopped", archived: true }))).toBe(false);
    expect(canRestart(card({ lastLine: "Stopped", role: "copilot" }))).toBe(false);
  });
});

describe("resumeAllTargets", () => {
  const card = (id: string, over: Partial<Card> = {}): Card => ({
    id, title: id, prompt: "p", cwd: "/x", backend: "claude", permissionMode: "default",
    column: "review", lastLine: CLOSED_LINE, sessionId: "s", createdAt: 0, updatedAt: 0, ...over,
  });

  it("picks Review cards the app closed on or that failed: continue with a session, restart without", () => {
    const cards = [
      card("closed"),
      card("failed", { lastLine: "Ended early", error: "API Error: 529" }),
      card("fresh", { sessionId: undefined }),
      card("mine", { lastLine: "Stopped" }),
      card("finished", { lastLine: "All done" }),
      card("filed", { archived: true }),
      card("elsewhere", { column: "backlog" }),
    ];
    expect(resumeAllTargets(cards)).toEqual([
      { id: "closed", how: "continue" },
      { id: "failed", how: "continue" },
      { id: "fresh", how: "restart" },
    ]);
  });
});
