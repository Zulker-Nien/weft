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

// jsdom's user agent is Linux by default, so the hotkeys registry's "mod" wouldn't match
// metaKey. Stub Mac so ⌘. matches the Continue shortcut.
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
  return { onSend, onStop, rerender: view.rerender };
}

function fireModDot() {
  const e = new KeyboardEvent("keydown", { key: ".", metaKey: true, bubbles: true, cancelable: true });
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

  it("isn't offered after a turn that finished cleanly: the primary is Send", () => {
    setup();
    expect(screen.queryByRole("button", { name: "Continue" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
  });
});

describe("Continue ⌘. shortcut", () => {
  it("sends 'continue' on metaKey+.", () => {
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
