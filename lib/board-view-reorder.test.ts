// The backlog-only order sort lives next to its callers in lib/board-view.ts; this file
// covers the user-facing behavior: a card with an order takes precedence over the chosen
// column sort, ties fall back to the sort, and other columns never look at order.
import { describe, expect, it } from "vitest";
import { groupByColumn } from "./board-view";
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

function view(overrides: Partial<Parameters<typeof groupByColumn>[1]> = {}) {
  return { project: null, query: "", sort: "newest" as const, showArchived: false, ...overrides };
}

const identity = (cwd: string) => cwd;

describe("groupByColumn backlog order", () => {
  it("sorts Backlog by each card's order first, then the chosen sort as the tiebreaker", () => {
    // Order contradicts the createdAt sort; Backlog should follow order.
    const a = card({ id: "a", column: "backlog", order: 30, createdAt: 100 });
    const b = card({ id: "b", column: "backlog", order: 10, createdAt: 200 });
    const c = card({ id: "c", column: "backlog", order: 20, createdAt: 300 });
    const groups = groupByColumn([a, b, c], view({ sort: "oldest" }), identity);
    expect(groups.get("backlog")?.map((c) => c.id)).toEqual(["b", "c", "a"]);
  });

  it("falls back to the chosen sort when two Backlog cards share an order", () => {
    // Both share order=1, so oldest (createdAt ascending) decides.
    const a = card({ id: "a", column: "backlog", order: 1, createdAt: 200 });
    const b = card({ id: "b", column: "backlog", order: 1, createdAt: 100 });
    const groups = groupByColumn([a, b], view({ sort: "oldest" }), identity);
    expect(groups.get("backlog")?.map((c) => c.id)).toEqual(["b", "a"]);
  });

  it("ignores order in columns other than Backlog", () => {
    // Even with an order field set, the running column follows the chosen sort.
    const a = card({ id: "a", column: "running", order: 99, createdAt: 100 });
    const b = card({ id: "b", column: "running", order: 1, createdAt: 200 });
    const groups = groupByColumn([a, b], view({ sort: "oldest" }), identity);
    expect(groups.get("running")?.map((c) => c.id)).toEqual(["a", "b"]);
  });
});
