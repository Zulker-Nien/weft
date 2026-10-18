// @vitest-environment happy-dom
// Review's Errors and Restart chips, end to end through the real column: the board's state, groupByColumn
// and the Review header, wired the way Board.tsx wires them.
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { groupByColumn, NO_REVIEW_FILTER, reviewFilterCounts, type ReviewFilter, type ReviewFilterKey } from "@/lib/board-view";
import type { Card } from "@/lib/types";
import BoardColumn from "./BoardColumn";

afterEach(cleanup);

const card = (id: string, lastLine: string): Card =>
  ({ id, title: id, prompt: id, lastLine, column: "review", backend: "claude", permissionMode: "default", cwd: "/r", createdAt: 0, updatedAt: 0 });

const CARDS = [
  card("normal", "Added the chips."),
  card("errored", "error: Claude Code process exited with code 1"),
  card("limited", "You've hit your session limit · resets 10:40pm (Asia/Bangkok)"),
];

function ReviewHarness() {
  const [on, setOn] = useState<ReviewFilter>(NO_REVIEW_FILTER);
  const list = groupByColumn(CARDS, { project: null, query: "", sort: "newest", showArchived: false, reviewFilter: on }, (c) => c).get("review") ?? [];
  const toggle = (key: ReviewFilterKey) => setOn((f) => ({ ...f, [key]: !f[key] }));
  return (
    <BoardColumn
      column={{ id: "review", label: "Review" }}
      shown={list}
      count={list.length}
      loaded
      filtering={false}
      dragOver={false}
      laneState="hidden"
      onShowMore={() => {}}
      renderCard={(c) => <div data-card-id={c.id}>{c.title}</div>}
      onDragOver={() => {}}
      onDragLeave={() => {}}
      onDrop={() => {}}
      onColumnContextMenu={() => {}}
      needsYou={false}
      archivedCount={0}
      showArchived={false}
      onToggleArchived={() => {}}
      toArchive={0}
      archiveTip=""
      onArchiveAll={() => {}}
      onAddBacklog={() => {}}
      reviewFilter={{ on, counts: reviewFilterCounts(list), toggle }}
    />
  );
}

const shownIds = () => [...document.querySelectorAll("[data-card-id]")].map((el) => el.getAttribute("data-card-id"));

describe("ReviewFilterChips", () => {
  it("Errors hides a normal card and keeps an errored one, with its count; a second click clears it", async () => {
    render(<ReviewHarness />);
    expect(shownIds()).toEqual(["normal", "errored", "limited"]);
    const errors = screen.getByRole("button", { name: "Errors" });
    await userEvent.click(errors);
    expect(shownIds()).toEqual(["errored"]);
    expect(errors.getAttribute("aria-pressed")).toBe("true");
    expect(errors.textContent).toContain("· 1");
    await userEvent.click(errors);
    expect(shownIds()).toEqual(["normal", "errored", "limited"]);
    expect(errors.textContent).not.toContain("·");
  });

  it("Restart errors keeps only the session-limit card, and both together keep either", async () => {
    render(<ReviewHarness />);
    await userEvent.click(screen.getByRole("button", { name: "Restart errors" }));
    expect(shownIds()).toEqual(["limited"]);
    await userEvent.click(screen.getByRole("button", { name: "Errors" }));
    expect(shownIds()).toEqual(["errored", "limited"]);
  });
});
