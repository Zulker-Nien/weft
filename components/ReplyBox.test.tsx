// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScheduledMessage } from "@/lib/types";
import "./test-utils";
import ReplyBox from "./ReplyBox";

const api = vi.hoisted(() => ({
  schedule: vi.fn(() => Promise.resolve()),
  unschedule: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/lib/client", () => ({ api }));
vi.mock("./Composer", () => import("./composer-mock"));

type Props = Parameters<typeof ReplyBox>[0];

// A puku thread: its send-later times (in 1 hour, tomorrow morning) don't depend on plan resets.
const later = (scheduled: ScheduledMessage[] = []) => ({ backend: "puku" as const, scheduled }) as Props["sendLater"];

function setup(props: Partial<Props> = {}) {
  const onSend = vi.fn<Props["onSend"]>(() => Promise.resolve());
  const onStop = vi.fn<Props["onStop"]>(() => Promise.resolve());
  const all: Props = { cardId: "c1", cwd: "/repo", live: false, placeholder: "Reply…", onSend, onStop, ...props };
  const view = render(<ReplyBox {...all} />);
  const rerender = (more: Partial<Props>) => view.rerender(<ReplyBox {...all} {...more} />);
  return { onSend, onStop, rerender, box: screen.getByRole("textbox", { name: "Message" }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe("ReplyBox", () => {
  it("Send sends what's typed and empties the box", async () => {
    const { onSend, box } = setup();
    await userEvent.type(box, "Ship it");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onSend).toHaveBeenCalledWith("Ship it");
    expect(box).toHaveValue("");
  });

  it("Enter sends; Shift+Enter adds a line", async () => {
    const { onSend, box } = setup();
    await userEvent.type(box, "one{Shift>}{Enter}{/Shift}two");
    expect(onSend).not.toHaveBeenCalled();
    await userEvent.type(box, "{Enter}");
    expect(onSend).toHaveBeenCalledWith("one\ntwo");
  });

  it("won't send an empty box", async () => {
    const { onSend } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByText("Write a message first.")).toBeInTheDocument();
  });

  it("shows a failed send and keeps the text", async () => {
    const { onSend, box } = setup();
    onSend.mockRejectedValueOnce(new Error("Thread is gone"));
    await userEvent.type(box, "Hello{Enter}");
    expect(await screen.findByText("Thread is gone")).toBeInTheDocument();
    expect(box).toHaveValue("Hello");
  });

  it("restores the card's unsent draft", () => {
    localStorage.setItem("weft.reply.c1", "half a thought");
    const { box } = setup();
    expect(box).toHaveValue("half a thought");
  });

  it("keeps what was just typed when the thread closes before the draft saves", async () => {
    const { box } = setup();
    await userEvent.type(box, "closing fast");
    cleanup();
    expect(localStorage.getItem("weft.reply.c1")).toBe("closing fast");
  });

  it("takes focus as it opens when asked (a card just started), and only then", () => {
    const { box } = setup({ autoFocus: true });
    expect(box).toHaveFocus();
    cleanup();
    expect(setup().box).not.toHaveFocus();
  });

  it("draws no busy-folder line: claims warn at the clash instead", () => {
    setup();
    expect(screen.queryByText(/Also running here/)).not.toBeInTheDocument();
  });

  describe("while a turn is running", () => {
    it("queues replies and sends them together when the turn ends", async () => {
      const { onSend, box, rerender } = setup({ live: true });
      await userEvent.type(box, "first{Enter}");
      await userEvent.type(box, "second{Enter}");
      expect(onSend).not.toHaveBeenCalled();
      expect(screen.getAllByText("Queued")).toHaveLength(2);
      expect(screen.getByText("first")).toBeInTheDocument();

      rerender({ live: false });
      await waitFor(() => expect(onSend).toHaveBeenCalledWith("first\n\nsecond"));
      expect(onSend).toHaveBeenCalledOnce();
      expect(screen.queryByText("Queued")).not.toBeInTheDocument();
    });

    it("a queued reply can be removed", async () => {
      const { onSend, box, rerender } = setup({ live: true });
      await userEvent.type(box, "never mind{Enter}");
      await userEvent.click(screen.getByRole("button", { name: "Remove queued message" }));
      expect(screen.queryByText("never mind")).not.toBeInTheDocument();
      rerender({ live: false });
      expect(onSend).not.toHaveBeenCalled();
    });

    it("Send now stops the turn, then sends", async () => {
      const { onSend, onStop, box } = setup({ live: true });
      await userEvent.type(box, "urgent");
      const calls: string[] = [];
      onStop.mockImplementation(() => (calls.push("stop"), Promise.resolve()));
      onSend.mockImplementation((text) => (calls.push(`send ${text}`), Promise.resolve()));
      await userEvent.click(screen.getByRole("button", { name: "Send now" }));
      expect(calls).toEqual(["stop", "send urgent"]);
    });

    it("Stop stops the turn", async () => {
      const { onStop, onSend } = setup({ live: true });
      await userEvent.click(screen.getByRole("button", { name: "Stop the current turn" }));
      expect(onStop).toHaveBeenCalledOnce();
      expect(onSend).not.toHaveBeenCalled();
    });

    it("the placeholder says the next message waits", () => {
      const { box } = setup({ live: true });
      expect(box).toHaveAttribute("placeholder", expect.stringMatching(/send when this turn is done/));
    });
  });

  describe("↑ edits your last message", () => {
    const editLast = (over: Partial<NonNullable<Props["editLast"]>> = {}) => ({
      text: "make it blue",
      canRewind: true,
      fileEdits: 0,
      onEdit: vi.fn<(text: string) => Promise<void>>(() => Promise.resolve()),
      ...over,
    });

    it("pulls it back, and Enter replaces it instead of sending a new message", async () => {
      const edit = editLast({ fileEdits: 2 });
      const onEditing = vi.fn();
      const { onSend, box } = setup({ editLast: edit, onEditing });
      await userEvent.type(box, "{ArrowUp}");
      expect(box).toHaveValue("make it blue");
      expect(onEditing).toHaveBeenLastCalledWith(true);
      expect(screen.getByText(/Enter replaces the reply below · Esc cancels · 2 file edits stay/)).toBeInTheDocument();
      await userEvent.clear(box);
      await userEvent.type(box, "make it red{Enter}");
      expect(edit.onEdit).toHaveBeenCalledWith("make it red");
      expect(onSend).not.toHaveBeenCalled();
      expect(box).toHaveValue("");
      expect(onEditing).toHaveBeenLastCalledWith(false);
    });

    it("Escape cancels the edit and keeps the thread open", async () => {
      const outside = vi.fn();
      window.addEventListener("keydown", outside);
      const edit = editLast({ fileEdits: 1 });
      const { box } = setup({ editLast: edit });
      await userEvent.type(box, "{ArrowUp}");
      expect(screen.getByText(/1 file edit stays/)).toBeInTheDocument();
      await userEvent.type(box, "{Escape}");
      window.removeEventListener("keydown", outside);
      expect(box).toHaveValue("");
      expect(outside).not.toHaveBeenCalledWith(expect.objectContaining({ key: "Escape" }));
      expect(screen.queryByText(/Editing/)).not.toBeInTheDocument();
      expect(edit.onEdit).not.toHaveBeenCalled();
    });

    it("says a running turn stops, and a thread that can't rewind sends a copy", async () => {
      const first = setup({ editLast: editLast(), live: true });
      await userEvent.type(first.box, "{ArrowUp}");
      expect(screen.getByText(/Enter stops this turn and replaces it/)).toBeInTheDocument();
      cleanup();
      const second = setup({ editLast: editLast({ canRewind: false }) });
      await userEvent.type(second.box, "{ArrowUp}");
      expect(screen.getByText(/this thread can't rewind, so it sends as a new message/)).toBeInTheDocument();
    });

    it("an emptied box cancels, a failed edit keeps the text, and a queued message comes back first", async () => {
      const onEdit = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());
      const edit = editLast({ onEdit });
      const { box, rerender } = setup({ editLast: edit });
      await userEvent.type(box, "{ArrowUp}");
      await userEvent.clear(box);
      await userEvent.type(box, "{Enter}");
      expect(onEdit).not.toHaveBeenCalled();
      expect(screen.queryByText(/Editing/)).not.toBeInTheDocument();

      onEdit.mockRejectedValueOnce(new Error("Thread is gone"));
      await userEvent.type(box, "{ArrowUp}{Enter}");
      expect(await screen.findByText("Thread is gone")).toBeInTheDocument();
      expect(box).toHaveValue("make it blue");
      await userEvent.type(box, "{Escape}");

      rerender({ editLast: edit, live: true });
      await userEvent.type(box, "queued one{Enter}{ArrowUp}");
      expect(box).toHaveValue("queued one");
      expect(screen.queryByText(/Editing/)).not.toBeInTheDocument();
    });
  });

  describe("suggested next message", () => {
    it("shows as the placeholder; Tab fills it in without sending", async () => {
      const { onSend, box } = setup({ suggestion: "run the tests" });
      expect(box).toHaveAttribute("placeholder", expect.stringMatching(/^run the tests/));
      box.focus();
      await userEvent.keyboard("{Tab}");
      expect(box).toHaveValue("run the tests");
      expect(onSend).not.toHaveBeenCalled();
    });

    it("Tab leaves typed text alone", async () => {
      const { box } = setup({ suggestion: "run the tests" });
      await userEvent.type(box, "commit");
      await userEvent.keyboard("{Tab}");
      expect(box).toHaveValue("commit");
    });

    it("isn't offered while the thread works", async () => {
      const { box } = setup({ suggestion: "run the tests", live: true });
      expect(box).toHaveAttribute("placeholder", expect.stringMatching(/send when this turn is done/));
      box.focus();
      await userEvent.keyboard("{Tab}");
      expect(box).toHaveValue("");
    });
  });

  it("idle, there's no Stop or Send now", () => {
    setup();
    expect(screen.queryByRole("button", { name: "Stop the current turn" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send now" })).not.toBeInTheDocument();
  });

  describe("send later", () => {
    it("is only offered where sendLater is given", () => {
      setup();
      expect(screen.queryByRole("button", { name: "Send later" })).not.toBeInTheDocument();
    });

    it("schedules the message for the picked time and empties the box", async () => {
      const { onSend, box } = setup({ sendLater: later() });
      await userEvent.type(box, "Morning report");
      await userEvent.click(screen.getByRole("button", { name: "Send later" }));
      await userEvent.click(screen.getByRole("button", { name: /In 1 hour/ }));
      expect(api.schedule).toHaveBeenCalledWith("c1", "Morning report", expect.any(Number));
      expect(onSend).not.toHaveBeenCalled();
      await waitFor(() => expect(box).toHaveValue(""));
    });

    it("won't schedule an empty box", async () => {
      setup({ sendLater: later() });
      await userEvent.click(screen.getByRole("button", { name: "Send later" }));
      await userEvent.click(screen.getByRole("button", { name: /In 1 hour/ }));
      expect(api.schedule).not.toHaveBeenCalled();
      expect(screen.getByText("Write a message first.")).toBeInTheDocument();
    });

    it("lists scheduled messages; one can be cancelled or taken back to edit", async () => {
      const scheduled: ScheduledMessage[] = [{ id: "m1", text: "Run the nightly", at: Date.now() + 3600_000 }];
      const { box } = setup({ sendLater: later(scheduled) });
      await userEvent.click(screen.getByRole("button", { name: "Cancel scheduled message" }));
      expect(api.unschedule).toHaveBeenCalledWith("c1", "m1");

      await userEvent.click(screen.getByRole("button", { name: "Run the nightly" }));
      expect(box).toHaveValue("Run the nightly");
      expect(api.unschedule).toHaveBeenCalledTimes(2);
    });
  });
});
