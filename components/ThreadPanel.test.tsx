// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeCard } from "./test-utils";
import ThreadPanel from "./ThreadPanel";

const api = vi.hoisted(() => ({ skills: vi.fn(() => Promise.resolve({ skills: [] })), stop: vi.fn(() => Promise.resolve()) }));
vi.mock("@/lib/client", () => ({ api }));
vi.mock("./Composer", () => import("./composer-mock"));

const resets = {};

function renderPanel(over: Parameters<typeof makeCard>[0] = {}) {
  const handlers = {
    onSend: vi.fn(() => Promise.resolve()),
    onAnswer: vi.fn(),
    onRelease: vi.fn(),
    onArchive: vi.fn(),
    onStar: vi.fn(),
    onTags: vi.fn(),
    onDelete: vi.fn(),
    onRename: vi.fn(),
    onMode: vi.fn(),
    onNewChat: vi.fn(),
  };
  render(<ThreadPanel card={makeCard(over)} items={[]} streaming="" resets={resets} {...handlers} />);
  return handlers;
}

afterEach(cleanup);

describe("ThreadPanel", () => {
  it("gives a board card its folder, tags, star, archive and delete", () => {
    renderPanel();
    // The fixture's folder is /Users/me/dev/app; folderName() shows "app" in the breadcrumb.
    expect(screen.getByTitle("/Users/me/dev/app")).toHaveTextContent("app");
    expect(screen.getByRole("button", { name: "Add a tag" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Archive card" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete card" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New chat" })).not.toBeInTheDocument();
  });

  it("opens the copilot like a card, for the whole board, with New chat in place of the card's buttons", async () => {
    const { onNewChat, onSend } = renderPanel({ id: "copilot", role: "copilot", title: "Copilot" });
    expect(screen.getByText("✨ whole board")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add a tag" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Archive card" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete card" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "New chat" }));
    expect(onNewChat).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "What needs my attention?" }));
    expect(onSend).toHaveBeenCalledWith("What needs my attention?");
  });

  it("doesn't let the copilot be renamed", async () => {
    renderPanel({ id: "copilot", role: "copilot", title: "Copilot" });
    await userEvent.click(screen.getByRole("heading", { name: "Copilot" }));
    expect(screen.queryByDisplayValue("Copilot")).not.toBeInTheDocument();
  });
});
