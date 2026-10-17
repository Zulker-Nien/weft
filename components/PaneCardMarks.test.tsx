// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import PaneCardMarks from "./PaneCardMarks";
import { makeCard } from "./test-utils";

afterEach(cleanup);

describe("PaneCardMarks", () => {
  it("shares, stars and archives the open card from the pane's toolbar", async () => {
    const props = { onShare: vi.fn(), onStar: vi.fn(), onArchive: vi.fn() };
    render(<PaneCardMarks card={makeCard()} {...props} />);
    await userEvent.click(screen.getByRole("button", { name: "Share" }));
    await userEvent.click(screen.getByRole("button", { name: "Archive card" }));
    expect(props.onShare).toHaveBeenCalledOnce();
    expect(props.onArchive).toHaveBeenCalledOnce();
  });

  it("can't archive a card mid-turn", () => {
    render(<PaneCardMarks card={makeCard({ column: "running" })} onArchive={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Archive card" })).toHaveProperty("disabled", true);
  });

  it("shows nothing for the copilot", () => {
    const { container } = render(<PaneCardMarks card={makeCard({ role: "copilot" })} onArchive={vi.fn()} />);
    expect(container.innerHTML).toBe("");
  });
});
