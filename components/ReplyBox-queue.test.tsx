// @vitest-environment jsdom
// Replies queued behind a running turn (lib/use-reply-queue.ts): they leave once, together, as the turn ends; a failed
// send puts them back on hold; a row's Send now sends just that one.
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./test-utils";
import ReplyBox from "./ReplyBox";

const api = vi.hoisted(() => ({
  schedule: vi.fn(() => Promise.resolve()),
  unschedule: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/lib/client", () => ({ api }));
vi.mock("./Composer", () => import("./composer-mock"));

type Props = Parameters<typeof ReplyBox>[0];

function setup(props: Partial<Props> = {}) {
  const onSend = vi.fn<Props["onSend"]>(() => Promise.resolve());
  const onStop = vi.fn<Props["onStop"]>(() => Promise.resolve());
  const all: Props = { cardId: "c1", cwd: "/repo", live: true, placeholder: "Reply…", onSend, onStop, ...props };
  const view = render(<ReplyBox {...all} />);
  const rerender = (more: Partial<Props>) => view.rerender(<ReplyBox {...all} {...more} />);
  return { onSend, onStop, rerender, box: screen.getByRole("textbox", { name: "Message" }) };
}

// The Send now button on the queued row that reads `text`.
function sendNowOn(text: string) {
  return within(screen.getByText(text).closest("li") as HTMLElement).getByRole("button", { name: "Send now" });
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});
afterEach(cleanup);

describe("queued replies", () => {
  it("go out exactly once, however often the box draws after the turn ends", async () => {
    const { onSend, box, rerender } = setup();
    await userEvent.type(box, "first{Enter}");
    rerender({ live: false });
    rerender({ live: false, placeholder: "Again…" });
    rerender({ live: false, suggestion: "next" });
    await waitFor(() => expect(onSend).toHaveBeenCalledWith("first"));
    expect(onSend).toHaveBeenCalledOnce();
  });

  it("a failed send comes back paused with the error, and an empty Enter sends it again", async () => {
    const { onSend, box, rerender } = setup();
    onSend.mockRejectedValueOnce(new Error("Thread is gone"));
    await userEvent.type(box, "first{Enter}");
    rerender({ live: false });
    expect(await screen.findByText("Thread is gone")).toBeInTheDocument();
    expect(screen.getByText("Paused")).toBeInTheDocument();
    expect(screen.getByText("first")).toBeInTheDocument();

    await userEvent.type(box, "{Enter}");
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(2));
    expect(onSend).toHaveBeenLastCalledWith("first");
    await waitFor(() => expect(screen.queryByText("Paused")).not.toBeInTheDocument());
  });

  it("a row's Send now stops the turn and sends just that one; the rest wait for the next turn to end", async () => {
    const { onSend, onStop, box, rerender } = setup();
    await userEvent.type(box, "first{Enter}");
    await userEvent.type(box, "second{Enter}");
    await userEvent.click(sendNowOn("second"));
    await waitFor(() => expect(onSend).toHaveBeenCalledWith("second"));
    expect(onStop).toHaveBeenCalledOnce();
    expect(onSend).toHaveBeenCalledOnce();
    expect(screen.getByText("first")).toBeInTheDocument();

    rerender({ live: false });
    await waitFor(() => expect(onSend).toHaveBeenLastCalledWith("first"));
  });

  it("a failed Send now puts the message back at the front of the queue", async () => {
    const { onSend, box } = setup();
    onSend.mockRejectedValueOnce(new Error("Offline"));
    await userEvent.type(box, "first{Enter}");
    await userEvent.type(box, "second{Enter}");
    await userEvent.click(sendNowOn("second"));
    expect(await screen.findByText("Offline")).toBeInTheDocument();
    const rows = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(rows[0]).toContain("second");
    expect(rows[1]).toContain("first");
  });

  it("Send now from the menu with an empty box sends the whole queue", async () => {
    const { onSend, onStop, box } = setup();
    await userEvent.type(box, "first{Enter}");
    await userEvent.type(box, "second{Enter}");
    await userEvent.click(screen.getByRole("button", { name: "More ways to send" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Send now (stops the turn)" }));
    await waitFor(() => expect(onSend).toHaveBeenCalledWith("first\n\nsecond"));
    expect(onStop).toHaveBeenCalledOnce();
    expect(screen.queryByText("Queued")).not.toBeInTheDocument();
  });

  it("holds while a queued message is pulled back to edit, and waits for Enter", async () => {
    const { onSend, box, rerender } = setup();
    await userEvent.type(box, "first{Enter}");
    await userEvent.type(box, "second{Enter}{ArrowUp}");
    expect(box).toHaveValue("second");
    expect(screen.getByText("Paused")).toBeInTheDocument();
    rerender({ live: false });
    expect(onSend).not.toHaveBeenCalled();
  });
});
