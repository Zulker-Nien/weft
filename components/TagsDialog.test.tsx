// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { makeCard } from "./test-utils";
import TagsDialog from "./TagsDialog";

const all = [
  { tag: "bug", count: 4 },
  { tag: "build", count: 2 },
  { tag: "ui", count: 1 },
];

function setup(tags?: string[]) {
  const onChange = vi.fn();
  const onClose = vi.fn();
  render(<TagsDialog card={makeCard({ tags })} all={all} onChange={onChange} onClose={onClose} />);
  return { onChange, onClose, input: screen.getByRole("textbox", { name: "Add a tag" }) };
}

describe("TagsDialog", () => {
  it("shows the card's tags as removable chips and saves each removal", async () => {
    const { onChange } = setup(["bug", "ui"]);
    await userEvent.click(screen.getByRole("button", { name: "Remove bug" }));
    expect(onChange).toHaveBeenLastCalledWith(["ui"]);
    expect(screen.queryByRole("button", { name: "Remove bug" })).not.toBeInTheDocument();
  });

  it("adds a normalized tag on Enter and on a comma, and skips repeats", async () => {
    const { onChange, input } = setup(["bug"]);
    await userEvent.type(input, "#Docs{Enter}");
    expect(onChange).toHaveBeenLastCalledWith(["bug", "docs"]);
    await userEvent.type(input, "api,");
    expect(onChange).toHaveBeenLastCalledWith(["bug", "docs", "api"]);
    await userEvent.type(input, "BUG{Enter}");
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(input).toHaveValue("");
  });

  it("Backspace on an empty input removes the last tag", async () => {
    const { onChange, input } = setup(["bug", "ui"]);
    await userEvent.type(input, "{Backspace}");
    expect(onChange).toHaveBeenLastCalledWith(["bug"]);
  });

  it("suggests the board's tags it doesn't have, by click or by arrows", async () => {
    const { onChange, input } = setup(["ui"]);
    await userEvent.type(input, "bu");
    const options = screen.getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["bug4", "build2"]);
    await userEvent.click(screen.getByRole("button", { name: /build/ }));
    expect(onChange).toHaveBeenLastCalledWith(["ui", "build"]);
    await userEvent.type(input, "b{ArrowDown}{ArrowUp}{ArrowDown}{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenLastCalledWith(["ui", "build", "bug"]);
  });

  it("stops taking tags at the limit", () => {
    setup(["a", "b", "c", "d", "e", "f", "g", "h"]);
    expect(screen.getByRole("textbox", { name: "Add a tag" })).toBeDisabled();
  });

  it("closes on Escape", async () => {
    const { onClose } = setup();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});
