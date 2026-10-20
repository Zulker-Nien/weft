// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useShortcutListener } from "@/lib/hotkeys";
import "./test-utils";
import ReplyBox from "./ReplyBox";

vi.mock("@/lib/client", () => ({ api: { schedule: vi.fn(), unschedule: vi.fn() } }));
vi.mock("./Composer", () => import("./composer-mock"));

type Props = Parameters<typeof ReplyBox>[0];

// A cache that went cold an hour ago.
const coldCache = { tokens: 184_100, at: Date.now() - 3600_000, ttl: 300, hit: 0 };

// jsdom's user agent is Linux by default, so the hotkeys registry's "mod" wouldn't match
// metaKey. Stub Mac so ⌘⇧↵ matches the Continue shortcut.
function onMac() {
  vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)" });
}

function setup(props: Partial<Props> = {}) {
  const onSend = vi.fn<Props["onSend"]>(() => Promise.resolve());
  const onStop = vi.fn<Props["onStop"]>(() => Promise.resolve());
  // Mount the registry's window listener once; the ReplyBox's useShortcuts hook only registers.
  function Listener() {
    useShortcutListener();
    return null;
  }
  const view = render(
    <>
      <Listener />
      <ReplyBox
        cardId="c1"
        cwd="/repo"
        live={false}
        placeholder="Reply…"
        onSend={onSend}
        onStop={onStop}
        {...props}
      />
    </>,
  );
  return { onSend, onStop, box: screen.getByRole("textbox", { name: "Message" }), rerender: view.rerender };
}

function fireModDot() {
  const e = new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, metaKey: true, bubbles: true, cancelable: true });
  window.dispatchEvent(e);
  return e;
}

beforeEach(() => {
  onMac();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("Continue button", () => {
  it("is the primary of an empty box after a cut-off turn, and sends the literal word 'continue'", async () => {
    const { onSend } = setup({ cutOff: true });
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onSend).toHaveBeenCalledWith("continue");
  });

  it("sits beside Send after a turn that finished cleanly", () => {
    setup();
    expect(screen.getByRole("button", { name: "Continue" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
  });
});

describe("Continue ⌘⇧↵ shortcut", () => {
  it("sends 'continue' on metaKey+shift+Enter", () => {
    const { onSend } = setup();
    fireModDot();
    expect(onSend).toHaveBeenCalledWith("continue");
  });

  it("is a no-op while a turn is running", () => {
    const { onSend } = setup({ live: true });
    fireModDot();
    expect(onSend).not.toHaveBeenCalled();
  });
});

describe("Continue visibility", () => {
  it("is hidden while a turn runs", () => {
    setup({ live: true, cutOff: true });
    expect(screen.queryByRole("button", { name: "Continue" })).not.toBeInTheDocument();
  });
});

// A model/CLI was just switched: the card lands on a fresh session with no prior assistant context.
// The reply box defaults to Send fresh, Continue is hidden, and ⌘⇧↵ is a no-op.
describe("no prior assistant context (model/CLI switched)", () => {
  it("the chip names the fresh-start state and Continue is hidden", () => {
    setup({ stale: { cache: coldCache, onFresh: vi.fn(() => Promise.resolve()) }, noPriorContext: true });
    expect(screen.getByText(/^Fresh start · was on another model/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue" })).not.toBeInTheDocument();
  });

  it("⌘⇧↵ does not send 'continue' and does not start a fresh session either", () => {
    const onFresh = vi.fn(() => Promise.resolve());
    const { onSend } = setup({ stale: { cache: coldCache, onFresh }, noPriorContext: true });
    fireModDot();
    expect(onSend).not.toHaveBeenCalled();
    expect(onFresh).not.toHaveBeenCalled();
  });

  it("clicking the primary Send fresh on Enter sends to onFresh, not onSend", async () => {
    const onFresh = vi.fn(() => Promise.resolve());
    const { onSend, box } = setup({ stale: { cache: coldCache, onFresh }, noPriorContext: true });
    await userEvent.type(box, "and the header{Enter}");
    expect(onFresh).toHaveBeenCalledWith("and the header");
    expect(onSend).not.toHaveBeenCalled();
  });
});
