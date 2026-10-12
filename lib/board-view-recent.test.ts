import { describe, expect, it } from "vitest";
import { RECENT_MOVE_MS, recentMoves } from "./board-view";
import type { Card } from "./types";

const NOW = 1_700_000_000_000;
let seq = 0;
const card = (over: Partial<Card> = {}): Card => ({
  id: `c${++seq}`,
  title: "Untitled",
  prompt: "p",
  cwd: "/repo",
  backend: "claude",
  permissionMode: "default",
  column: "review",
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
});

describe("recentMoves", () => {
  it("lists cards that moved column within a day, latest move first, up to the limit", () => {
    const old = card({ columnAt: NOW - RECENT_MOVE_MS });
    const never = card();
    const copilot = card({ role: "copilot", columnAt: NOW - 1 });
    const a = card({ columnAt: NOW - 5_000 });
    const b = card({ columnAt: NOW - 1_000 });
    const c = card({ columnAt: NOW - 9_000 });
    const all = [old, never, copilot, a, b, c];
    expect(recentMoves(all, NOW).map((x) => x.id)).toEqual([b.id, a.id, c.id]);
    expect(recentMoves(all, NOW, 2).map((x) => x.id)).toEqual([b.id, a.id]);
  });
});
