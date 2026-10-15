// @vitest-environment happy-dom
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { onScrollToTurn, reportTopTurn } from "@/lib/glance-events";
import type { Card, ThreadItem } from "@/lib/types";
import GlanceRail from "./GlanceRail";

afterEach(cleanup);

const at = Date.now();
const card = { id: "c1", column: "review" } as Card;
const items: ThreadItem[] = [
  { kind: "user", text: "add a glance rail", at },
  { kind: "assistant", text: "On it.", at },
  { kind: "result", text: "", isError: false, at },
];

describe("GlanceRail", () => {
  it("draws nothing with no card open, or while hidden", () => {
    const { container, rerender } = render(<GlanceRail card={null} hidden={false} items={items} pageUrl="" />);
    expect(container.innerHTML).toBe("");
    rerender(<GlanceRail card={card} hidden items={items} pageUrl="" />);
    expect(container.innerHTML).toBe("");
  });

  it("draws one mini per turn, newest at the bottom, with its dot and time", () => {
    render(<GlanceRail card={card} hidden={false} items={items} pageUrl="" />);
    const minis = screen.getAllByRole("button");
    expect(minis.map((m) => m.textContent)).toEqual(["add a glance railjust now", "On it.just now"]);
    expect(screen.getByLabelText("Finished")).toBeTruthy();
    expect(screen.getByLabelText("You")).toBeTruthy();
  });

  it("asks the chat to scroll to a clicked turn and marks it active", async () => {
    const scrolled = vi.fn();
    const off = onScrollToTurn(scrolled);
    render(<GlanceRail card={card} hidden={false} items={items} pageUrl="" />);
    await userEvent.click(screen.getByTitle("add a glance rail"));
    expect(scrolled).toHaveBeenCalledWith("t0");
    expect(screen.getByTitle("add a glance rail").getAttribute("aria-current")).toBe("true");
    off();
  });

  it("lists the pages the agent opened, and reopens one on click with its turn scrolled into view", async () => {
    const open = vi.fn(() => Promise.resolve());
    window.threadboard = { browser: { open } } as unknown as typeof window.threadboard;
    const scrolled = vi.fn();
    const off = onScrollToTurn(scrolled);
    const withPage: ThreadItem[] = [...items.slice(0, 2), { kind: "tool", id: "o", name: "mcp__browser__open_url", summary: "http://localhost:3000/a", at }];
    render(<GlanceRail card={card} hidden={false} items={withPage} pageUrl="http://localhost:3000/b" />);
    await userEvent.click(screen.getByTitle("http://localhost:3000/a"));
    expect(open).toHaveBeenCalledWith("http://localhost:3000/a");
    expect(scrolled).toHaveBeenCalledWith("t1");
    // The turn that opened it puts the pane back on it too.
    await userEvent.click(screen.getByTitle("On it."));
    expect(open).toHaveBeenCalledTimes(2);
    off();
  });

  it("adds a page you open by hand, but not the card's first page or one the rail reopened", () => {
    const other = { id: "c2", column: "review" } as Card;
    const view = (c: Card, url: string) => <GlanceRail card={c} hidden={false} items={items} pageUrl={url} />;
    const { rerender } = render(view(other, "http://first.test/"));
    expect(screen.queryByLabelText("Page")).toBeNull();
    rerender(view(other, "http://second.test/"));
    expect(screen.getByLabelText("Page on screen")).toBeTruthy();
    expect(screen.getByTitle("http://second.test/")).toBeTruthy();
    rerender(view(other, "http://second.test/"));
    expect(screen.getAllByTitle(/^http/)).toHaveLength(1);
  });

  it("marks the turn the chat reports at its top", async () => {
    render(<GlanceRail card={card} hidden={false} items={items} pageUrl="" />);
    await act(() => {
      reportTopTurn("t1");
      return Promise.resolve();
    });
    expect(screen.getByTitle("On it.").getAttribute("aria-current")).toBe("true");
  });
});
