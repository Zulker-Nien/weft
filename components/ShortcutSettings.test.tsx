// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import ShortcutSettings from "./ShortcutSettings";
import "./test-utils";

beforeEach(() => {
  localStorage.clear();
});

describe("ShortcutSettings", () => {
  it("lists the rebindable dictation row at the top and tells the user how to rebind", () => {
    render(<ShortcutSettings titleClass="title" hintClass="hint" />);
    expect(screen.getByText(/Click a shortcut, then press the keys you want/)).toBeInTheDocument();
    // The rebind row is the only place with a "Reset" button.
    expect(screen.getByRole("button", { name: "Reset" })).toBeInTheDocument();
  });

  it("lists the fixed shortcuts from the catalog, grouped by what they do", () => {
    render(<ShortcutSettings titleClass="title" hintClass="hint" />);
    expect(screen.getByText("All keyboard shortcuts")).toBeInTheDocument();
    // A handful of fixed entries from lib/shortcut-catalog.ts: a reply key, a composer key,
    // a palette key, a terminal key, and a desktop app key — they exist whether or not
    // anything is currently registered, so the test doesn't depend on the registry.
    expect(screen.getByText("Send a reply, or queue it while a turn runs")).toBeInTheDocument();
    expect(screen.getByText("Bold")).toBeInTheDocument();
    expect(screen.getByText("Next result in the command palette")).toBeInTheDocument();
    expect(screen.getByText("Split the terminal")).toBeInTheDocument();
    expect(screen.getByText("Close the window")).toBeInTheDocument();
  });

  it("groups the list with one section per ShortcutGroup that has entries", () => {
    render(<ShortcutSettings titleClass="title" hintClass="hint" />);
    // SHORTCUT_GROUPS from lib/hotkeys.ts: empty groups are filtered out by shortcutSections, so
    // "Board" (only registered shortcuts) doesn't appear when nothing's registered. The others
    // have at least one fixed entry from lib/shortcut-catalog.ts.
    const expected = ["General", "Thread", "Writing", "Terminal & browser", "App"];
    const headings = screen.getAllByRole("heading", { level: 5 });
    const names = headings.map((h) => h.textContent);
    for (const g of expected) expect(names).toContain(g);
  });

  it("hints that ? opens the same list as a sheet anywhere", () => {
    render(<ShortcutSettings titleClass="title" hintClass="hint" />);
    const hint = screen.getByText(/open this list as a sheet/i);
    expect(within(hint).getByText("?")).toBeInTheDocument();
  });
});
