import { describe, expect, it } from "vitest";
import { groupByColumn, shownColumn, type BoardView } from "./board-view";
import type { Card } from "./types";

const card = (over: Partial<Card>): Card =>
  ({ id: "c", title: "t", prompt: "p", cwd: "/", backend: "claude", permissionMode: "default", column: "running", createdAt: 1, updatedAt: 1, ...over });

describe("shownColumn", () => {
  it("draws a running card that's wrapping up (/done) in Done", () => {
    expect(shownColumn(card({ wrappingUp: true }))).toBe("done");
  });

  it("leaves every other card in its own column", () => {
    expect(shownColumn(card({}))).toBe("running");
    expect(shownColumn(card({ column: "needs_you", wrappingUp: true }))).toBe("needs_you");
    expect(shownColumn(card({ column: "review", wrappingUp: false }))).toBe("review");
  });

  it("groups a wrapping-up card under Done on the board", () => {
    const view: BoardView = { project: null, query: "", sort: "active", showArchived: false };
    const groups = groupByColumn([card({ id: "w", wrappingUp: true }), card({ id: "r" })], view, (cwd) => cwd);
    expect(groups.get("done")?.map((c) => c.id)).toEqual(["w"]);
    expect(groups.get("running")?.map((c) => c.id)).toEqual(["r"]);
  });
});
