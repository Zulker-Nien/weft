import { describe, expect, it } from "vitest";
import { cleanCardIds, cleanSprintName, defaultSprintName, sprintViews, type Sprint } from "./sprints";
import type { Card } from "./types";

const day = Date.UTC(2026, 9, 18, 12);
const sprint = (over: Partial<Sprint>): Sprint => ({ id: "s", name: "Sprint 1", cardIds: [], createdAt: 0, ...over });
const card = (over: Partial<Card>) => ({ id: "c", column: "backlog", ...over }) as Card;

describe("cleanSprintName", () => {
  it("trims and collapses whitespace", () => {
    expect(cleanSprintName("  Launch \n week ")).toBe("Launch week");
  });
  it("caps the length", () => {
    expect(cleanSprintName("x".repeat(200))).toHaveLength(80);
  });
  it("has nothing for blanks and non-strings", () => {
    expect(cleanSprintName("   ")).toBeUndefined();
    expect(cleanSprintName(3)).toBeUndefined();
  });
});

describe("defaultSprintName", () => {
  it("starts at Sprint 1 with the day", () => {
    expect(defaultSprintName([], day)).toBe("Sprint 1 · Oct 18");
  });
  it("goes one past the highest numbered sprint, so a deleted one isn't repeated", () => {
    const names = ["Sprint 3 · Oct 1", "Launch", "Sprint 1 · Sep 9"].map((name) => sprint({ name }));
    expect(defaultSprintName(names, day)).toBe("Sprint 4 · Oct 18");
  });
});

describe("cleanCardIds", () => {
  it("keeps non-empty strings once each", () => {
    expect(cleanCardIds(["a", "b", "a", "", 4, null])).toEqual(["a", "b"]);
  });
  it("is empty for anything but an array", () => {
    expect(cleanCardIds("a")).toEqual([]);
  });
});

describe("sprintViews", () => {
  it("lists the newest first, with what became of each sprint's cards", () => {
    const cards = [
      card({ id: "a", archived: true }),
      card({ id: "b", column: "running" }),
      card({ id: "c" }),
    ];
    const old = sprint({ id: "old", cardIds: ["a", "b", "gone"], createdAt: 1 });
    const fresh = sprint({ id: "new", cardIds: ["c"], createdAt: 2 });
    const [first, second] = sprintViews([old, fresh], cards);
    expect(first!.sprint.id).toBe("new");
    expect(second!.cards.map((c) => c.id)).toEqual(["a", "b"]);
    expect(second!.archived.map((c) => c.id)).toEqual(["a"]);
    expect(second!.started).toBe(1);
  });
});
