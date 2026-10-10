// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScheduledMessage } from "@/lib/types";
import { makeCard } from "./test-utils";
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

  it("warns when other threads are running in this folder", () => {
    setup({ alsoHere: [makeCard({ id: "c2", title: "Refactor auth", column: "running" })] });
    expect(screen.getByText("Also running here: Refactor auth")).toBeInTheDocument();
  });

  it("has no warning when nothing else runs here", () => {
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
