// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import "./test-utils";
import BoardHeader from "./BoardHeader";

// Renders BoardHeader with the handlers wired and a no-op hint, then asserts the share button
// exposes it in the toolbar (not just behind the avatar). The command palette and the avatar
// menu still have their own entries, so this test only pins the toolbar placement.
function renderHeader(handlers: Partial<Parameters<typeof BoardHeader>[0]> = {}) {
  const props = {
    mac: false,
    running: 0,
    waiting: 0,
    browserOpen: false,
    terminalOpen: false,
    hint: (_id: string, fallback: string) => fallback,
    onToggleBrowser: vi.fn(),
    onToggleTerminal: vi.fn(),
    onShareBoard: vi.fn(),
    onOpenSettings: vi.fn(),
    onOpenNew: vi.fn(),
    restartChip: null,
    headerBadges: null,
    copilotButton: null,
    accountButton: null,
    ...handlers,
  };
  return { ...render(<BoardHeader {...props} />), props };
}

describe("BoardHeader", () => {
  it("exposes a Share the board button that calls onShareBoard", async () => {
    const onShareBoard = vi.fn();
    renderHeader({ onShareBoard });
    const button = screen.getByRole("button", { name: "Share the board" });
    expect(button).toHaveAttribute("title", "Share the board");
    await userEvent.click(button);
    expect(onShareBoard).toHaveBeenCalledTimes(1);
  });
});
