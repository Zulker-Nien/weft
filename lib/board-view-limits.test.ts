import { describe, expect, it } from "vitest";
import { planLimitsFor } from "./board-view";
import type { Card } from "./types";

let cardSeq = 0;
function card(overrides: Partial<Card> = {}): Card {
  cardSeq += 1;
  const base: Card = {
    id: `c${cardSeq}`,
    title: "Untitled",
    prompt: "do the thing",
    cwd: "/repo",
    backend: "claude",
    permissionMode: "default",
    column: "backlog",
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
  };
  return { ...base, ...overrides };
}

describe("planLimitsFor", () => {
  it("is empty when no thread on that CLI reported limits", () => {
    const cards = [card({ stats: { model: "opus" } }), card({ backend: "puku", stats: { fiveHour: { used: 5 } } })];
    expect(planLimitsFor(cards, "claude")).toEqual({});
  });

  it("takes the CLI's latest limits and nothing else", () => {
    const old = card({ updatedAt: 100, stats: { fiveHour: { used: 10 }, tokens: 9 } });
    const recent = card({ updatedAt: 300, stats: { model: "opus", fiveHour: { used: 30 }, sevenDay: { used: 40 } } });
    const puku = card({ updatedAt: 500, backend: "puku", stats: { fiveHour: { used: 90 } } });
    expect(planLimitsFor([old, puku, recent], "claude")).toEqual({ fiveHour: { used: 30 }, sevenDay: { used: 40 } });
  });

  it("counts a weekly limit alone", () => {
    expect(planLimitsFor([card({ stats: { sevenDay: { used: 20 } } })], "claude")).toEqual({ fiveHour: undefined, sevenDay: { used: 20 } });
  });
});
