import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Automation, Card } from "./types";

// settings.ts reads ~/.weft; swap in the rules each test wants.
let rules: Automation[] = [];
vi.mock("./settings", () => ({ automations: () => rules }));

import { firstMessage, messagesForMove, skillsForPrompt } from "./automations";

const card = (over: Partial<Card> = {}) => ({ id: "c1", prompt: "Fix the bug", sessionId: "s1", ...over }) as Card;

beforeEach(() => {
  rules = [];
});

describe("firstMessage", () => {
  it("is just the prompt with no start rules", () => {
    rules = [{ id: "a", on: "done", skill: "weft:done" }];
    expect(firstMessage(card())).toBe("Fix the bug");
  });

  it("appends one start skill as an instruction", () => {
    rules = [{ id: "a", on: "start", skill: "plan" }];
    expect(firstMessage(card())).toBe("Fix the bug\n\nStart by using the /plan skill.");
  });

  it("lists several start skills in order and drops duplicates", () => {
    rules = [
      { id: "a", on: "start", skill: "plan" },
      { id: "b", on: "start", skill: "weft:preview" },
      { id: "c", on: "start", skill: "plan" },
    ];
    expect(firstMessage(card())).toBe("Fix the bug\n\nStart by using these skills, in order: /plan, /weft:preview.");
  });
});

describe("messagesForMove", () => {
  beforeEach(() => {
    rules = [
      { id: "a", on: "done", skill: "weft:done" },
      { id: "b", on: "review", skill: "weft:preview" },
    ];
  });

  it("runs the skills for the column moved into", () => {
    expect(messagesForMove(card(), "done")).toEqual(["/weft:done"]);
    expect(messagesForMove(card(), "review")).toEqual(["/weft:preview"]);
  });

  it("does nothing for other columns", () => {
    for (const column of ["backlog", "running", "needs_you"] as const) {
      expect(messagesForMove(card(), column)).toEqual([]);
    }
  });

  it("does nothing for a card that never ran", () => {
    expect(messagesForMove(card({ sessionId: undefined }), "done")).toEqual([]);
  });

  it("leaves a Claude Code session Weft hasn't run alone", () => {
    expect(messagesForMove(card({ source: "claude-code" }), "done")).toEqual([]);
    expect(messagesForMove(card({ source: "claude-code", lastWeftTurn: 123 }), "done")).toEqual(["/weft:done"]);
  });

  it("returns nothing when no rule matches", () => {
    rules = [];
    expect(messagesForMove(card(), "done")).toEqual([]);
  });
});

describe("skillsForPrompt", () => {
  const rule = (over: Partial<Automation> = {}): Automation => ({
    id: "p",
    on: "prompt-matches",
    skill: "vercel:knowledge-update",
    pattern: "vercel|deploy",
    ...over,
  });

  it("returns the skill of a rule whose pattern matches, ignoring case", () => {
    rules = [rule()];
    expect(skillsForPrompt(card(), "Please DEPLOY this")).toEqual(["vercel:knowledge-update"]);
  });

  it("returns nothing when no pattern matches", () => {
    rules = [rule()];
    expect(skillsForPrompt(card(), "Fix the bug")).toEqual([]);
  });

  it("ignores rules of other triggers and rules without a pattern", () => {
    rules = [rule({ on: "done" }), rule({ pattern: undefined }), rule({ pattern: "  " })];
    expect(skillsForPrompt(card(), "vercel deploy")).toEqual([]);
  });

  it("ignores an invalid regex and still applies the other rules", () => {
    rules = [rule({ pattern: "(" }), rule({ id: "q", skill: "plan", pattern: "deploy" })];
    expect(skillsForPrompt(card(), "( deploy")).toEqual(["plan"]);
  });

  it("runs each skill once per thread", () => {
    rules = [rule(), rule({ id: "q", pattern: "vercel" })];
    expect(skillsForPrompt(card(), "vercel")).toEqual(["vercel:knowledge-update"]);
    expect(skillsForPrompt(card({ promptSkills: ["vercel:knowledge-update"] }), "vercel")).toEqual([]);
  });
});
