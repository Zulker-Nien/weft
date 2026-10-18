// @vitest-environment happy-dom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useReplyContinue } from "./use-reply-continue";
import { useShortcutListener, useShortcutList } from "./hotkeys";

// ⌘. is a Mac shortcut — hotkeys.ts matches "mod" against metaKey only when the user agent looks
// like macOS. jsdom defaults to Linux, so stub the UA to Mac for these tests.
function onMac() {
  vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)" });
}

type Opts = Parameters<typeof useReplyContinue>[0];

// Mounts the window listener plus the Continue hook (its only registration). Without the listener
// the hook's registered shortcut never sees a keydown. Other tests in this file can add their own
// useShortcuts renders on top of this without un-mounting the listener.
function setup(over: Partial<Opts> = {}): { result: { current: { canContinue: boolean; sendContinue: () => void } }; opts: Opts } {
  const opts: Opts = {
    live: false,
    question: false,
    shell: false,
    editing: false,
    onSend: vi.fn(() => Promise.resolve()),
    setError: vi.fn(),
    ...over,
  };
  renderHook(() => useShortcutListener());
  const { result } = renderHook(() => useReplyContinue(opts));
  return { result, opts };
}

// ⌘. on macOS, Ctrl+. elsewhere.
function fireDot() {
  const e = new KeyboardEvent("keydown", { key: ".", metaKey: true, bubbles: true, cancelable: true });
  window.dispatchEvent(e);
  return e;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("canContinue", () => {
  it("is true when the thread is idle and the box is normal", () => {
    const { result } = setup();
    expect(result.current.canContinue).toBe(true);
  });

  it("is false while a turn runs, a question waits, a shell command is being entered, or the last message is being edited", () => {
    for (const flip of [{ live: true }, { question: true }, { shell: true }, { editing: true }] as const) {
      const { result } = setup(flip);
      expect(result.current.canContinue).toBe(false);
    }
  });
});

describe("sendContinue", () => {
  it("sends the literal word 'continue' through onSend", () => {
    const { result, opts } = setup();
    result.current.sendContinue();
    expect(opts.onSend).toHaveBeenCalledWith("continue");
  });

  it("does nothing when canContinue is false (a turn is running)", () => {
    const { result, opts } = setup({ live: true });
    result.current.sendContinue();
    expect(opts.onSend).not.toHaveBeenCalled();
  });

  it("reports a failed send through setError", async () => {
    const { result, opts } = setup();
    const onSend = opts.onSend as unknown as ReturnType<typeof vi.fn>;
    const err = new Error("thread is gone");
    onSend.mockRejectedValueOnce(err);
    result.current.sendContinue();
    await vi.waitFor(() => expect(opts.setError).toHaveBeenCalledWith(err));
  });
});

describe("⌘. shortcut", () => {
  it("sends 'continue' on the metaKey+. keydown", async () => {
    onMac();
    const { opts } = setup();
    fireDot();
    await vi.waitFor(() => expect(opts.onSend).toHaveBeenCalledWith("continue"));
  });

  it("does nothing while a turn is running, even with the key", () => {
    onMac();
    const { opts } = setup({ live: true });
    fireDot();
    expect(opts.onSend).not.toHaveBeenCalled();
  });

  it("does nothing on plain '.' without the modifier", () => {
    onMac();
    const { opts } = setup();
    const e = new KeyboardEvent("keydown", { key: ".", bubbles: true, cancelable: true });
    window.dispatchEvent(e);
    expect(opts.onSend).not.toHaveBeenCalled();
  });
});

// Pulls the registered shortcut out of the registry, so the help dialog's shortcut list keeps a
// "reply-continue" entry (the "?" sheet is one of the review tour's stops).
describe("registry", () => {
  it("registers a shortcut in the Thread group with mod+.", () => {
    const { result } = renderHook(() => {
      useShortcutListener();
      useReplyContinue({
        live: false,
        question: false,
        shell: false,
        editing: false,
        onSend: vi.fn(),
        setError: vi.fn(),
      });
      return useShortcutList();
    });
    const entry = result.current.find((s) => s.id === "reply-continue");
    expect(entry).toBeDefined();
    expect(entry?.group).toBe("Thread");
    expect(entry?.keys).toEqual(["mod+."]);
  });
});
