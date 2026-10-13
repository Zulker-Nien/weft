// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeCard } from "./test-utils";
import CardView, { BackendBadge } from "./CardView";
import BackendPicker from "./BackendPicker";

const api = vi.hoisted(() => ({
  login: vi.fn(() => Promise.resolve()),
  switchBackend: vi.fn(() => Promise.resolve()),
}));
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

  it("names the model beside the CLI dot once it's known, with the effort in its tooltip", () => {
    renderCard({ stats: { runsOn: { model: "claude-opus-5-5", effort: "high" } } });
    expect(screen.getByText("Opus 5.5")).toHaveAttribute("title", "Claude Code on claude-opus-5-5 · high effort");
  });

  it("shows no model before the CLI reports one", () => {
    renderCard();
    expect(screen.queryByText(/Opus|Sonnet|Fable|Haiku/)).not.toBeInTheDocument();
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

  it("a card waiting on you can be dragged; a running one can't", () => {
    const question = { ...pending, questions: [{ question: "Which?", header: "Pick", options: [], multiSelect: false }] };
    renderCard({ column: "needs_you", pending: question });
    expect(screen.getByText("Fix the login page").closest("[data-card-id]")).toHaveAttribute("draggable", "true");
    cleanup();
    renderCard({ column: "running" });
    expect(screen.getByText("Fix the login page").closest("[data-card-id]")).toHaveAttribute("draggable", "false");
  });

  it("a permission parked in Backlog still offers Allow and Deny", () => {
    renderCard({ column: "backlog", pending });
    expect(screen.getByRole("button", { name: "Allow" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deny" })).toBeInTheDocument();
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
  it("has a ☆ that stars the card without opening it", async () => {
    const onStar = vi.fn();
    const { onOpen } = renderCard({}, { onStar });
    await userEvent.click(screen.getByRole("button", { name: "Star" }));
    expect(onStar).toHaveBeenCalledOnce();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("shows ★ on a starred card", () => {
    renderCard({ starred: true }, { onStar: vi.fn() });
    expect(screen.getByRole("button", { name: "Starred" })).toHaveTextContent("★");
  });

  it("has no star button without a handler", () => {
    renderCard({ starred: true });
    expect(screen.queryByRole("button", { name: /Star/ })).not.toBeInTheDocument();
  });
});

describe("CardView copilot", () => {
  const copilot = { id: "copilot", role: "copilot" as const, title: "Copilot", column: "review" as const };

  it("says it runs the whole board instead of naming its folder", () => {
    renderCard(copilot);
    expect(screen.getByText("whole board")).toBeInTheDocument();
    expect(screen.queryByText("app")).not.toBeInTheDocument();
  });

  it("can't be dragged or starred", () => {
    renderCard(copilot, { onStar: vi.fn() });
    expect(screen.getByText("Copilot").closest("[data-card-id]")).toHaveAttribute("draggable", "false");
    expect(screen.queryByRole("button", { name: /Star/ })).not.toBeInTheDocument();
  });

  it("opens on click", async () => {
    const { onOpen } = renderCard(copilot);
    await userEvent.click(screen.getByText("Copilot"));
    expect(onOpen).toHaveBeenCalledOnce();
  });
});

describe("CardView tags and issue", () => {
  it("shows two tags in the footer and +N for the rest", () => {
    renderCard({ tags: ["bug", "ui", "docs", "api"] });
    expect(screen.getByText("bug")).toBeInTheDocument();
    expect(screen.getByText("ui")).toBeInTheDocument();
    expect(screen.queryByText("docs")).not.toBeInTheDocument();
    expect(screen.getByText("+2")).toHaveAttribute("title", "docs, api");
  });

  it("a tag click filters the board without opening the card", async () => {
    const onTag = vi.fn();
    const { onOpen } = renderCard({ tags: ["bug"] }, { onTag });
    await userEvent.click(screen.getByRole("button", { name: "bug" }));
    expect(onTag).toHaveBeenCalledWith("bug");
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("links the card's GitHub issue", () => {
    renderCard({ issue: { repo: "aimhuge/weft", number: 42, url: "https://github.com/aimhuge/weft/issues/42", state: "open", updatedAt: "" } });
    const link = screen.getByRole("link", { name: "#42" });
    expect(link).toHaveAttribute("href", "https://github.com/aimhuge/weft/issues/42");
    expect(link).toHaveAttribute("title", "aimhuge/weft#42 (open)");
  });

  it("shows nothing extra without tags or an issue", () => {
    renderCard();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByText(/^\+\d+$/)).not.toBeInTheDocument();
  });
});

describe("BackendBadge", () => {
  afterEach(cleanup);

  it("says the CLI until it knows the model", () => {
    render(<BackendBadge backend="puku" />);
    expect(screen.getByText("puku")).toBeInTheDocument();
  });

  it("names the model and effort the CLI reported, or the card's own picks", () => {
    const runsOn = { model: "claude-opus-5-5", effort: "xhigh" as const };
    render(<BackendBadge backend="claude" card={makeCard({ stats: { runsOn } })} />);
    expect(screen.getByText("Opus 5.5 · xhigh")).toBeInTheDocument();
    cleanup();
    render(<BackendBadge backend="claude" card={makeCard({ model: "claude-fable-5-1", effort: "max", stats: { runsOn } })} />);
    expect(screen.getByText("Fable 5.1 · max")).toBeInTheDocument();
    cleanup();
    render(<BackendBadge backend="puku" card={makeCard({ backend: "puku", stats: { runsOn: { model: "puku-ai-2.8" } } })} />);
    expect(screen.getByText("Puku AI 2.8")).toBeInTheDocument();
  });
});

describe("BackendPicker", () => {
  afterEach(cleanup);

  it("lists each CLI's models, marks the current one, and switches CLI with the picked model", async () => {
    render(<BackendPicker card={makeCard({ backend: "claude", model: "claude-opus-5-5" })} />);
    await userEvent.click(screen.getByRole("button", { name: /Switch model/ }));
    expect(screen.getByRole("button", { name: "Opus 5.5" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Opus 4.8" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("group", { name: "puku-cli" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Puku AI 2.7" }));
    expect(api.switchBackend).toHaveBeenCalledWith("c1", "puku", false, "puku-ai-2.7");
  });

  it("a puku card left with a Claude model shows puku's default as current", async () => {
    render(<BackendPicker card={makeCard({ backend: "puku", model: "claude-fable-5-1" })} />);
    await userEvent.click(screen.getByRole("button", { name: /Switch model/ }));
    expect(screen.getByRole("button", { name: "Opus 4.8" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Fable 5.1" })).toHaveAttribute("aria-pressed", "false");
  });

  it("is a no-op when the chosen model is the card's own", async () => {
    render(<BackendPicker card={makeCard({ backend: "puku", model: "puku-ai-2.8" })} />);
    await userEvent.click(screen.getByRole("button", { name: /Switch model/ }));
    await userEvent.click(screen.getByRole("button", { name: "Puku AI 2.8" }));
    expect(api.switchBackend).not.toHaveBeenCalled();
  });

  it("while live, keeps this CLI's models and disables the other CLI's", async () => {
    render(<BackendPicker card={makeCard({ backend: "claude", column: "running" })} />);
    await userEvent.click(screen.getByRole("button", { name: /Switch model/ }));
    expect(screen.getByRole("button", { name: "Sonnet 5.5" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Opus 4.8" })).toBeDisabled();
    expect(screen.getByText("Stop the thread to switch CLI.")).toBeInTheDocument();
  });

  it("the copilot doesn't get a switcher — just the static badge", () => {
    render(<BackendPicker card={makeCard({ id: "copilot", backend: "claude", role: "copilot" })} />);
    expect(screen.queryByRole("button", { name: /Switch model/ })).not.toBeInTheDocument();
    expect(screen.getByText("claude")).toBeInTheDocument();
  });
});
