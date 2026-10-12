// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeCard } from "./test-utils";
import CardView from "./CardView";

const api = vi.hoisted(() => ({ login: vi.fn(() => Promise.resolve()) }));
vi.mock("@/lib/client", () => ({ api }));

const pending = { id: "p1", toolName: "Bash", title: "Run npm test", input: {} };

function renderCard(over: Parameters<typeof makeCard>[0] = {}, props: Partial<Parameters<typeof CardView>[0]> = {}) {
  const handlers = { onOpen: vi.fn(), onAnswer: vi.fn(), onStop: vi.fn() };
  render(<CardView card={makeCard(over)} now={0} selected={false} {...handlers} {...props} />);
  return handlers;
}

beforeEach(() => vi.clearAllMocks());

describe("CardView", () => {
  it("shows the title, the last line, the folder and the stage", () => {
    renderCard({ lastLine: "Tests pass.", stage: "Polishing", remaining: "commit" });
    expect(screen.getByText("Fix the login page")).toBeInTheDocument();
    expect(screen.getByText("Tests pass.")).toBeInTheDocument();
    expect(screen.getByText("app")).toBeInTheDocument();
    expect(screen.getByText("Polishing")).toBeInTheDocument();
    expect(screen.getByText("· commit")).toBeInTheDocument();
  });

  it("shows the error instead of the last line", () => {
    renderCard({ lastLine: "Working", error: "CLI crashed" });
    expect(screen.getByText("CLI crashed")).toBeInTheDocument();
    expect(screen.queryByText("Working")).not.toBeInTheDocument();
  });

  it("▶ sends continue on an idle card with a session, without opening the thread", async () => {
    const onResume = vi.fn();
    const { onOpen } = renderCard({ lastLine: "I'll stop here.", sessionId: "s1" }, { onResume });
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onResume).toHaveBeenCalledWith("continue");
    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Restart" })).not.toBeInTheDocument();
  });

  it("a stopped card also offers Restart; a running one offers neither", async () => {
    const onResume = vi.fn();
    renderCard({ lastLine: "Stopped", sessionId: "s1" }, { onResume });
    await userEvent.click(screen.getByRole("button", { name: "Restart" }));
    expect(onResume).toHaveBeenCalledWith("restart");
    cleanup();
    renderCard({ column: "running", sessionId: "s1" }, { onResume });
    expect(screen.queryByRole("button", { name: "Continue" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Restart" })).not.toBeInTheDocument();
  });

  it("opens on click", async () => {
    const { onOpen } = renderCard();
    await userEvent.click(screen.getByText("Fix the login page"));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  describe("+N here", () => {
    const others = [makeCard({ id: "c2", title: "Other", column: "running" }), makeCard({ id: "c3", title: "Third", column: "running" })];

    it("flags other busy cards in the folder while this one is busy", () => {
      renderCard({ column: "running" }, { alsoHere: others });
      expect(screen.getByText("+2 here")).toBeInTheDocument();
    });

    it("stays hidden when this card isn't busy", () => {
      renderCard({ column: "review" }, { alsoHere: others });
      expect(screen.queryByText(/here$/)).not.toBeInTheDocument();
    });

    it("stays hidden when nothing else is busy here", () => {
      renderCard({ column: "running" }, { alsoHere: [] });
      expect(screen.queryByText(/here$/)).not.toBeInTheDocument();
    });
  });

  it("Allow and Deny answer the permission once, without opening the card", async () => {
    const { onAnswer, onOpen } = renderCard({ column: "needs_you", pending });
    const allow = screen.getByRole("button", { name: "Allow" });
    await userEvent.click(allow);
    expect(onAnswer).toHaveBeenCalledWith(true);
    expect(onOpen).not.toHaveBeenCalled();
    // A second click can't answer it again.
    expect(allow).toBeDisabled();
    expect(screen.getByRole("button", { name: "Deny" })).toBeDisabled();
    await userEvent.click(allow);
    expect(onAnswer).toHaveBeenCalledOnce();
  });

  it("Deny answers false", async () => {
    const { onAnswer } = renderCard({ column: "needs_you", pending });
    await userEvent.click(screen.getByRole("button", { name: "Deny" }));
    expect(onAnswer).toHaveBeenCalledWith(false);
  });

  it("questions get an Answer button that opens the card instead of Allow/Deny", async () => {
    const { onOpen } = renderCard({
      column: "needs_you",
      pending: { ...pending, questions: [{ question: "Which?", header: "Pick", options: [], multiSelect: false }] },
    });
    expect(screen.queryByRole("button", { name: "Allow" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Answer" }));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("a running card has a Stop button that stops without opening", async () => {
    const { onStop, onOpen } = renderCard({ column: "running" });
    await userEvent.click(screen.getByRole("button", { name: "Stop this thread" }));
    expect(onStop).toHaveBeenCalledOnce();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("an idle card has no Stop button", () => {
    renderCard({ column: "review" });
    expect(screen.queryByRole("button", { name: "Stop this thread" })).not.toBeInTheDocument();
  });

  it("a login prompt gets a Log in button that starts the CLI's login", async () => {
    renderCard({ column: "needs_you", lastLine: "Log in to Claude Code to continue" });
    await userEvent.click(screen.getByRole("button", { name: "Log in" }));
    expect(api.login).toHaveBeenCalledWith("claude", "start");
  });
});

describe("CardView star", () => {
  it("has a ☆ that opens the star menu without opening the card", async () => {
    const onStarMenu = vi.fn();
    const { onOpen } = renderCard({}, { onStarMenu });
    await userEvent.click(screen.getByRole("button", { name: "Star" }));
    expect(onStarMenu).toHaveBeenCalledOnce();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("shows ★ on a starred card", () => {
    renderCard({ libraryId: "lib1" }, { onStarMenu: vi.fn() });
    expect(screen.getByRole("button", { name: "Starred" })).toHaveTextContent("★");
  });

  it("has no star button without a menu to open", () => {
    renderCard({ libraryId: "lib1" });
    expect(screen.queryByRole("button", { name: /Star/ })).not.toBeInTheDocument();
  });
});
