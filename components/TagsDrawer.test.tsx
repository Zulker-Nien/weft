// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "./test-utils";
import TagsDrawer from "./TagsDrawer";

const catalog = {
  tags: [
    { name: "bug", color: "#d73a4a", count: 3 },
    { name: "docs", count: 0 },
  ],
  create: vi.fn(() => Promise.resolve()),
  rename: vi.fn(() => Promise.resolve()),
  recolor: vi.fn(() => Promise.resolve()),
  remove: vi.fn(() => Promise.resolve()),
};

function setup(active?: string) {
  const onFilter = vi.fn();
  const onDropCard = vi.fn();
  render(<TagsDrawer catalog={catalog} active={active} onFilter={onFilter} onDropCard={onDropCard} />);
  return { onFilter, onDropCard };
}

beforeEach(() => vi.clearAllMocks());

describe("TagsDrawer", () => {
  it("lists every tag with its count; a click filters the board", async () => {
    const { onFilter } = setup("bug");
    expect(screen.getByRole("button", { name: "bug" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("3")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "docs" }));
    expect(onFilter).toHaveBeenCalledWith("docs");
  });

  it("creates a tag, with a colour if one is picked", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "New tag colour" }));
    await userEvent.click(screen.getByRole("button", { name: "#1d76db" }));
    await userEvent.type(screen.getByRole("textbox", { name: "New tag name" }), "API{Enter}");
    expect(catalog.create).toHaveBeenCalledWith("API", "#1d76db");
    expect(screen.getByRole("textbox", { name: "New tag name" })).toHaveValue("");
  });

  it("renames inline, and Escape cancels", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Rename bug" }));
    const input = screen.getByRole("textbox", { name: "New name for bug" });
    await userEvent.clear(input);
    await userEvent.type(input, "defect{Enter}");
    expect(catalog.rename).toHaveBeenCalledWith("bug", "defect");
    await userEvent.dblClick(screen.getByRole("button", { name: "docs" }));
    await userEvent.type(screen.getByRole("textbox", { name: "New name for docs" }), "x{Escape}");
    expect(catalog.rename).toHaveBeenCalledOnce();
  });

  it("recolours a tag", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Colour of docs" }));
    await userEvent.click(screen.getByRole("button", { name: "#0e8a16" }));
    expect(catalog.recolor).toHaveBeenCalledWith("docs", "#0e8a16");
  });

  it("deletes after a confirm that says how many cards lose it", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Delete bug" }));
    expect(confirm).toHaveBeenCalledWith("Delete the tag “bug”? 3 cards will lose it.");
    expect(catalog.remove).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Delete bug" }));
    expect(catalog.remove).toHaveBeenCalledWith("bug");
  });

  it("says how to start with no tags", () => {
    render(<TagsDrawer catalog={{ ...catalog, tags: [] }} onFilter={vi.fn()} onDropCard={vi.fn()} />);
    expect(screen.getByText(/No tags yet/)).toBeInTheDocument();
  });
});
