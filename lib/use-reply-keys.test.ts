// @vitest-environment happy-dom
import { renderHook } from "@testing-library/react";
import type { KeyboardEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import { useReplyKeys, type UseReplyKeysOptions } from "./use-reply-keys";

function key(k: string, mods: Partial<Record<"shiftKey" | "altKey" | "metaKey" | "ctrlKey", boolean>> = {}) {
  return { key: k, shiftKey: false, altKey: false, metaKey: false, ctrlKey: false, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...mods };
}
const asEvent = (e: ReturnType<typeof key>) => e as unknown as KeyboardEvent;
const taken = (e: ReturnType<typeof key>) => e.preventDefault.mock.calls.length > 0 && e.stopPropagation.mock.calls.length > 0;

function setup(over: Partial<UseReplyKeysOptions> & { empty?: boolean } = {}) {
  const { empty = true, ...rest } = over;
  const composer = { current: { isEmpty: () => empty, write: vi.fn() } };
  const opts = {
    composer,
    form: { current: null },
    question: undefined,
    live: false,
    suggestion: undefined,
    editing: false,
    editLast: undefined,
    queue: [],
    sendLater: undefined,
    setLaterOpen: vi.fn(),
    cancelEdit: vi.fn(),
    setEditing: vi.fn(),
    setQueue: vi.fn(),
    setPaused: vi.fn(),
    onStop: vi.fn(() => Promise.resolve()),
    setError: vi.fn(),
    ...rest,
  } as unknown as UseReplyKeysOptions;
  const { result } = renderHook(() => useReplyKeys(opts));
  return { result, opts, write: composer.current.write };
}

describe("onKeyDownCapture", () => {
  it("lets an open question take the key", () => {
    const form = { current: { key: vi.fn(() => true) } };
    const { result } = setup({ question: {} as never, form: form as never });
    const e = key("1");
    result.current.onKeyDownCapture(asEvent(e));
    expect(form.current.key).toHaveBeenCalledWith(e, true);
    expect(taken(e)).toBe(true);
  });

  it("falls through when the question doesn't want the key", () => {
    const form = { current: { key: vi.fn(() => false) } };
    const { result, opts } = setup({ question: {} as never, form: form as never });
    const e = key("x");
    result.current.onKeyDownCapture(asEvent(e));
    expect(taken(e)).toBe(false);
    expect(opts.setLaterOpen).not.toHaveBeenCalled();
  });

  it("Alt+Enter opens Send later when it's offered, and only then", () => {
    const sendLater = {} as never;
    const a = setup({ sendLater });
    const e = key("Enter", { altKey: true });
    a.result.current.onKeyDownCapture(asEvent(e));
    expect(a.opts.setLaterOpen).toHaveBeenCalledWith(true);
    expect(taken(e)).toBe(true);

    const b = setup({ sendLater });
    b.result.current.onKeyDownCapture(asEvent(key("Enter", { altKey: true, shiftKey: true })));
    expect(b.opts.setLaterOpen).not.toHaveBeenCalled();

    const c = setup();
    c.result.current.onKeyDownCapture(asEvent(key("Enter", { altKey: true })));
    expect(c.opts.setLaterOpen).not.toHaveBeenCalled();
  });

  it("Tab in an empty box takes the suggestion", () => {
    const { result, write } = setup({ suggestion: "next step" });
    const e = key("Tab");
    result.current.onKeyDownCapture(asEvent(e));
    expect(write).toHaveBeenCalledWith("next step");
    expect(taken(e)).toBe(true);
  });

  it("Tab leaves the box alone with a modifier, no suggestion, a live turn or text typed", () => {
    for (const over of [{ suggestion: "s", live: true }, { suggestion: undefined }, { suggestion: "s", empty: false }]) {
      const { result, write } = setup(over);
      result.current.onKeyDownCapture(asEvent(key("Tab")));
      expect(write).not.toHaveBeenCalled();
    }
    const { result, write } = setup({ suggestion: "s" });
    result.current.onKeyDownCapture(asEvent(key("Tab", { shiftKey: true })));
    expect(write).not.toHaveBeenCalled();
  });

  it("Escape drops an edit", () => {
    const { result, opts } = setup({ editing: true });
    const e = key("Escape");
    result.current.onKeyDownCapture(asEvent(e));
    expect(opts.cancelEdit).toHaveBeenCalled();
    expect(taken(e)).toBe(true);
  });

  it("Up pulls the last queued message back and pauses the queue", () => {
    const { result, opts, write } = setup({ queue: ["a", "b"] });
    const e = key("ArrowUp");
    result.current.onKeyDownCapture(asEvent(e));
    expect(write).toHaveBeenCalledWith("b");
    expect(opts.setPaused).toHaveBeenCalledWith(true);
    const update = vi.mocked(opts.setQueue).mock.calls[0]?.[0] as (q: string[]) => string[];
    expect(update(["a", "b"])).toEqual(["a"]);
    expect(taken(e)).toBe(true);
  });

  it("Up with nothing queued edits the last sent message", () => {
    const { result, opts, write } = setup({ editLast: { text: "sent" } });
    result.current.onKeyDownCapture(asEvent(key("ArrowUp")));
    expect(write).toHaveBeenCalledWith("sent");
    expect(opts.setEditing).toHaveBeenCalledWith(true);
  });

  it("Up does nothing when there's nothing to pull back, the box has text, it's already editing, or it's another key", () => {
    for (const over of [{}, { queue: ["a"], empty: false }, { editLast: { text: "x" }, editing: true }]) {
      const { result, write } = setup(over);
      result.current.onKeyDownCapture(asEvent(key("ArrowUp")));
      expect(write).not.toHaveBeenCalled();
    }
    const { result, write } = setup({ queue: ["a"] });
    result.current.onKeyDownCapture(asEvent(key("ArrowDown")));
    expect(write).not.toHaveBeenCalled();
  });
});

describe("onKeyDown", () => {
  it("Ctrl+C stops a running turn and reports a failure", async () => {
    const { result, opts } = setup({ live: true });
    const e = key("c", { ctrlKey: true });
    result.current.onKeyDown(asEvent(e));
    expect(opts.onStop).toHaveBeenCalled();
    expect(e.preventDefault).toHaveBeenCalled();

    const err = new Error("stop failed");
    const b = setup({ live: true, onStop: vi.fn(() => Promise.reject(err)) });
    b.result.current.onKeyDown(asEvent(key("C", { ctrlKey: true })));
    await vi.waitFor(() => expect(b.opts.setError).toHaveBeenCalledWith(err));
  });

  it("Ctrl+C copies when text is selected, and does nothing when idle or with Cmd", () => {
    const selected = setup({ live: true });
    vi.spyOn(window, "getSelection").mockReturnValue({ toString: () => "picked" } as Selection);
    selected.result.current.onKeyDown(asEvent(key("c", { ctrlKey: true })));
    expect(selected.opts.onStop).not.toHaveBeenCalled();
    vi.restoreAllMocks();

    const idle = setup({ live: false });
    idle.result.current.onKeyDown(asEvent(key("c", { ctrlKey: true })));
    expect(idle.opts.onStop).not.toHaveBeenCalled();

    const meta = setup({ live: true });
    meta.result.current.onKeyDown(asEvent(key("c", { ctrlKey: true, metaKey: true })));
    expect(meta.opts.onStop).not.toHaveBeenCalled();
  });
});
