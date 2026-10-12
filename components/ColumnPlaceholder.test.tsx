// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "./test-utils";
import ColumnPlaceholder from "./ColumnPlaceholder";

describe("ColumnPlaceholder", () => {
  it("draws a column's placeholder cards while the board loads, hidden from screen readers", () => {
    render(<ColumnPlaceholder column="running" loaded={false} empty filtering={false} />);
    const cards = screen.getAllByTestId("card-skeleton");
    expect(cards).toHaveLength(3);
    for (const card of cards) expect(card.getAttribute("aria-hidden")).toBe("true");
    expect(screen.queryByText(/Drag a backlog card/)).toBeNull();
  });

  it("staggers the pulse so the cards don't blink in step", () => {
    render(<ColumnPlaceholder column="done" loaded={false} empty filtering={false} />);
    const delays = screen.getAllByTestId("card-skeleton").map((c) => c.style.animationDelay);
    expect(delays).toEqual(["0ms", "120ms", "240ms"]);
  });

  it("shows the column's hint once loaded and empty", () => {
    render(<ColumnPlaceholder column="review" loaded empty filtering={false} />);
    expect(screen.getByText("Cards land here when a turn finishes")).toBeTruthy();
    expect(screen.queryByTestId("card-skeleton")).toBeNull();
  });

  it("says nothing matches while a filter empties the column", () => {
    render(<ColumnPlaceholder column="review" loaded empty filtering />);
    expect(screen.getByText("No matching cards")).toBeTruthy();
  });

  it("draws nothing once the column has cards", () => {
    const { container } = render(<ColumnPlaceholder column="review" loaded empty={false} filtering={false} />);
    expect(container.innerHTML).toBe("");
  });
});
