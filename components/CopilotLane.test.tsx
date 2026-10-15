// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ThreadItem } from "@/lib/types";
import CopilotLane from "./CopilotLane";
import { makeCard } from "./test-utils";

const thread = vi.hoisted(() => ({
  card: null as ReturnType<typeof makeCard> | null,
  items: [] as ThreadItem[],
  send: vi.fn(async () => {}),
  newChat: vi.fn(async () => {}),
}));

vi.mock("@/lib/use-copilot-thread", () => ({
  useCopilotThread: () => ({ ...thread, streaming: "", error: null, fail: vi.fn() }),
}));
vi.mock("./ThreadView", () => ({
  default: ({ items }: { items: ThreadItem[] }) => <div data-testid="thread">{items.length} items</div>,
}));

beforeEach(() => {
  thread.card = makeCard({ id: "copilot", role: "copilot", column: "review", warm: true });
  thread.items = [
    { kind: "user", text: "status?", at: 10 },
    { kind: "assistant", text: "All quiet on the board.", at: 11 },
  ];
  thread.send.mockClear();
});

function lane(open: boolean, over: Partial<Parameters<typeof CopilotLane>[0]> = {}) {
  const props = { open, onToggle: vi.fn(), cards: [], onOpenCard: vi.fn(), toggleTip: "Copilot (⌘J)", ...over };
  render(<CopilotLane {...props} />);
  return props;
}

describe("CopilotLane minimized", () => {
  it("shows what finished, what needs you and the latest reply", () => {
    const waiting = makeCard({ id: "w", title: "Pick a domain", column: "needs_you", updatedAt: 20 });
    const props = lane(false, { cards: [waiting, makeCard({ id: "d", column: "done", updatedAt: 30 })] });
    expect(screen.getByText(/1 finished, 1 needs you/)).toBeInTheDocument();
    expect(screen.getByText("All quiet on the board.")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Pick a domain"));
    expect(props.onOpenCard).toHaveBeenCalledWith(waiting);
  });

  it("says when nothing waits on you", () => {
    lane(false);
    expect(screen.getByText(/0 finished, nothing waiting on you/)).toBeInTheDocument();
  });

  it("opens the cockpit from the peek and the header", () => {
    const props = lane(false);
    fireEvent.click(screen.getByText("Open the cockpit"));
    fireEvent.click(screen.getByLabelText("Open the copilot"));
    expect(props.onToggle).toHaveBeenCalledTimes(2);
  });

  it("sends a question from the ask box and opens the lane", () => {
    const props = lane(false);
    const input = screen.getByPlaceholderText("Ask the copilot…");
    fireEvent.submit(input, { target: { value: "" } });
    expect(thread.send).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "what needs me?" } });
    fireEvent.submit(input);
    expect(props.onToggle).toHaveBeenCalled();
    expect(thread.send).toHaveBeenCalledWith("what needs me?");
  });
});

describe("CopilotLane open", () => {
  it("shows the conversation and minimizes from the header", () => {
    const props = lane(true);
    expect(screen.getByTestId("thread")).toHaveTextContent("2 items");
    expect(screen.getByText("Ready")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Minimize the copilot"));
    expect(props.onToggle).toHaveBeenCalled();
  });

  it("starts a new chat", () => {
    lane(true);
    fireEvent.click(screen.getByText("New chat"));
    expect(thread.newChat).toHaveBeenCalled();
  });

  it("offers Stop while the copilot works", () => {
    thread.card = makeCard({ id: "copilot", role: "copilot", column: "running" });
    lane(true);
    expect(screen.getByText("Working")).toBeInTheDocument();
    expect(screen.getByText("Stop")).toBeInTheDocument();
  });

  it("waits for the copilot's card", () => {
    thread.card = null;
    lane(true);
    expect(screen.getByText("Starting…")).toBeInTheDocument();
    expect(screen.queryByTestId("thread")).not.toBeInTheDocument();
  });
});
