// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import RailFilterChip from "./RailFilterChip";

afterEach(cleanup);

describe("RailFilterChip", () => {
  it("draws nothing when the rail isn't filtering", () => {
    const { container } = render(<RailFilterChip filter={{}} onClear={vi.fn()} />);
    expect(container.innerHTML).toBe("");
  });

  it("clears the star filter and keeps the tag", async () => {
    const onClear = vi.fn();
    render(<RailFilterChip filter={{ starred: true, tag: "bug" }} onClear={onClear} />);
    await userEvent.click(screen.getByTitle("Show every card, not just starred ones"));
    expect(onClear).toHaveBeenCalledWith({ starred: undefined, tag: "bug" });
  });

  it("clears the tag filter and keeps the star", async () => {
    const onClear = vi.fn();
    render(<RailFilterChip filter={{ starred: true, tag: "bug" }} onClear={onClear} />);
    expect(screen.getByText("#bug")).toBeTruthy();
    await userEvent.click(screen.getByTitle("Show every card, not just #bug"));
    expect(onClear).toHaveBeenCalledWith({ starred: true, tag: undefined });
  });
});
