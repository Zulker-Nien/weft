// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { FilterMatch } from "@/lib/board-view";
import { makeCard } from "./test-utils";
import FilterBox from "./FilterBox";

vi.mock("@/lib/hotkeys", async (real) => ({
  ...(await real<typeof import("@/lib/hotkeys")>()),
  useShortcutList: () => [
    { id: "filter", keys: ["/"] },
    { id: "palette", keys: ["mod+k"] },
  ],
}));

const login = makeCard({ id: "a", title: "Fix the login page" });
const logout = makeCard({ id: "b", title: "Log out button", column: "running" });
const bugged = makeCard({ id: "c", title: "Refactor parser", tags: ["bug"] });

function setup(matches: FilterMatch[] = [{ card: login }, { card: logout }]) {
  const onOpen = vi.fn();
  const onSearchAll = vi.fn();
  function Harness() {
    const [query, setQuery] = useState("");
    return <FilterBox query={query} onQuery={setQuery} matches={query ? matches : []} onOpen={onOpen} onSearchAll={onSearchAll} />;
  }
  render(<Harness />);
  return { onOpen, onSearchAll, input: screen.getByRole("combobox", { name: "Filter cards" }) };
}

describe("FilterBox", () => {
  it("shows the / key while empty, even when focused", async () => {
    const { input } = setup();
    await userEvent.click(input);
    expect(screen.getByText("/")).toBeInTheDocument();
    await userEvent.type(input, "lo");
    expect(screen.queryByText("/")).not.toBeInTheDocument();
  });

  it("lists matching cards while typing and opens the first on Enter", async () => {
    const { input, onOpen } = setup();
    await userEvent.type(input, "lo");
    expect(screen.getByRole("option", { name: /Fix the login page/ })).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{Enter}");
    expect(onOpen).toHaveBeenCalledWith(login);
  });

  it("arrows down to the palette row, which hands over the query", async () => {
    const { input, onSearchAll } = setup();
    await userEvent.type(input, "lo");
    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    expect(screen.getByRole("option", { name: /Search prompts/ })).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{Enter}");
    expect(onSearchAll).toHaveBeenCalled();
  });

  it("offers the palette when nothing matches, and clicks open a card", async () => {
    const { input, onSearchAll } = setup([]);
    await userEvent.type(input, "zz");
    expect(screen.getByText("No cards match")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("option", { name: /Search prompts/ }));
    expect(onSearchAll).toHaveBeenCalled();
  });

  it("closes the list on blur and clears on Escape", async () => {
    const { input, onOpen } = setup();
    await userEvent.type(input, "lo");
    await userEvent.click(screen.getByRole("option", { name: /Log out button/ }));
    expect(onOpen).toHaveBeenCalledWith(logout);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    await userEvent.click(input);
    await userEvent.keyboard("{Escape}");
    expect(input).toHaveValue("");
  });

  it("shows a tag chip on rows that arrived via a tag match", async () => {
    const { input } = setup([{ card: bugged, matchedTag: "bug" }]);
    await userEvent.type(input, "bug");
    // The matched tag rides the row next to the title so the cause of the match is visible.
    const row = screen.getByRole("option", { name: /Refactor parser/ });
    expect(within(row).getByText("bug")).toBeInTheDocument();
  });
});

