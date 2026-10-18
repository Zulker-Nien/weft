// @vitest-environment jsdom
// The reply box's primary picks the right default (lib/reply-mode.ts): a new card when the cache is cold, a send at
// the reset when the 5-hour window is used up, and the mode chip that says so.
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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

// A cache that went cold an hour ago.
const coldCache = { tokens: 184_100, at: Date.now() - 3600_000, ttl: 300, hit: 0 };

function setup(props: Partial<Props> = {}) {
  const onSend = vi.fn<Props["onSend"]>(() => Promise.resolve());
  const onStop = vi.fn<Props["onStop"]>(() => Promise.resolve());
  render(<ReplyBox cardId="c1" cwd="/repo" live={false} placeholder="Reply…" onSend={onSend} onStop={onStop} {...props} />);
  return { onSend, box: screen.getByRole("textbox", { name: "Message" }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});
afterEach(cleanup);

describe("cold cache", () => {
  it("makes New card the primary; it carries the box's text and says which card started", async () => {
    const onContinue = vi.fn(() => Promise.resolve("Fix the footer"));
    const { onSend, box } = setup({ stale: { cache: coldCache, onContinue } });
    expect(screen.getByText(/^Cache cold · /)).toBeInTheDocument();
    await userEvent.type(box, "and the header");
    await userEvent.click(screen.getByRole("button", { name: "New card" }));
    expect(onContinue).toHaveBeenCalledWith("and the header");
    expect(onSend).not.toHaveBeenCalled();
    expect(await screen.findByText("Started “Fix the footer”")).toBeInTheDocument();
    expect(box).toHaveValue("");
  });

  it("won't start a new card from Enter in an empty box", async () => {
    const onContinue = vi.fn(() => Promise.resolve("x"));
    const { box } = setup({ stale: { cache: coldCache, onContinue } });
    await userEvent.type(box, "{Enter}");
    expect(onContinue).not.toHaveBeenCalled();
    expect(screen.getByText("Write a message first, or click New card.")).toBeInTheDocument();
  });

  it("still sends here from the menu, and shows a failed hand-off", async () => {
    const onContinue = vi.fn(() => Promise.reject(new Error("no summary")));
    const { onSend, box } = setup({ stale: { cache: coldCache, onContinue } });
    await userEvent.type(box, "go on");
    await userEvent.click(screen.getByRole("button", { name: "New card" }));
    expect(await screen.findByText("no summary")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "More ways to send" }));
    await userEvent.click(screen.getByRole("menuitem", { name: /^Send here · re-sends/ }));
    expect(onSend).toHaveBeenCalledWith("go on");
  });
});

describe("5-hour window used up", () => {
  it("schedules for the reset instead of sending", async () => {
    const reset = Math.floor(Date.now() / 1000) + 3600;
    const { onSend, box } = setup({ fiveHour: { used: 100, resetsAt: reset }, sendLater: { backend: "claude", resets: {}, scheduled: [] } });
    expect(screen.getByText("5-hour limit used up")).toBeInTheDocument();
    await userEvent.type(box, "after the reset");
    await userEvent.click(screen.getByRole("button", { name: /^Send at / }));
    expect(api.schedule).toHaveBeenCalledWith("c1", "after the reset", reset * 1000);
    expect(onSend).not.toHaveBeenCalled();
    await waitFor(() => expect(box).toHaveValue(""));
  });
});

describe("mode chip", () => {
  it("names the queue while a turn runs, and nothing on a plain reply", () => {
    setup({ live: true });
    expect(screen.getByText("Queue · after this turn")).toBeInTheDocument();
    cleanup();
    setup();
    expect(screen.queryByText(/Queue/)).not.toBeInTheDocument();
  });
});
