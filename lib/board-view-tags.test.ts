import { describe, expect, it } from "vitest";
import { groupByColumn, topMatches } from "./board-view";
import type { Card } from "./types";

// The filter box now narrows by tag: a free-text query matches a card's tags, and a `tag:foo`
// prefix narrows to that tag alone (case-insensitive, whitespace tolerated). Kept beside
// board-view's main suite so lib/board-view.test.ts doesn't push past its ratchet cap.
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

describe("groupByColumn tag filtering", () => {
  it("matches a card's tags as part of the free-text query", () => {
    const tagged = card({ id: "t", tags: ["bug", "ui"] });
    const untagged = card({ id: "u" });
    expect(groupByColumn([tagged, untagged], view({ query: "bug" }), identity).get("backlog")?.map((c) => c.id)).toEqual(["t"]);
    expect(groupByColumn([tagged, untagged], view({ query: "  UI  " }), identity).get("backlog")?.map((c) => c.id)).toEqual(["t"]);
  });

  it("tag:foo matches only that tag, not a title word", () => {
    const tagged = card({ id: "t", title: "refactor", tags: ["bug"] });
    const titled = card({ id: "x", title: "tag:bug in the title" });
    const groups = groupByColumn([tagged, titled], view({ query: "tag:bug" }), identity);
    expect(groups.get("backlog")?.map((c) => c.id)).toEqual(["t"]);
  });

  it("tag:foo is case-insensitive and tolerates a space after the colon", () => {
    const a = card({ id: "a", tags: ["Bug"] });
    const b = card({ id: "b", tags: ["perf"] });
    const groups = groupByColumn([a, b], view({ query: "tag: bug" }), identity);
    expect(groups.get("backlog")?.map((c) => c.id)).toEqual(["a"]);
  });

  it("topMatches records the tag that caused a tag:foo match", () => {
    const a = card({ id: "a", tags: ["Bug", "perf"] });
    const groups = groupByColumn([a], view({ query: "tag:bug" }), identity);
    const matches = topMatches(groups, 5, "tag:bug");
    expect(matches).toEqual([{ card: a, matchedTag: "Bug" }]);
  });

  it("topMatches records the first card tag that the free-text needle landed in", () => {
    const a = card({ id: "a", tags: ["ui-bug", "perf"] });
    const b = card({ id: "b", title: "bug elsewhere" });
    const groups = groupByColumn([a, b], view({ query: "bug" }), identity);
    const matches = topMatches(groups, 5, "bug");
    const byId = Object.fromEntries(matches.map((m) => [m.card.id, m.matchedTag]));
    expect(byId.a).toBe("ui-bug");
    expect(byId.b).toBeUndefined();
  });
});
