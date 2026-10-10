// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isMac,
  isTyping,
  keyCaps,
  keyLabel,
  SHORTCUT_GROUPS,
  toAccelerator,
  useShortcutHint,
  useShortcutList,
  useShortcutListener,
  useShortcuts,
  type ShortcutDef,
} from "./hotkeys";

function onMac() {
  vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)" });
}

function def(over: Partial<ShortcutDef> & Pick<ShortcutDef, "id" | "keys">): ShortcutDef {
  return { description: over.id, group: "Board", handler: () => {}, ...over };
}

// Mounts the window listener plus one component's shortcuts.
function mount(...defs: ShortcutDef[]) {
  renderHook(() => useShortcutListener());
  return renderHook((props: { defs: ShortcutDef[] }) => useShortcuts(props.defs), { initialProps: { defs } });
}

function press(key: string, init: KeyboardEventInit = {}, target: EventTarget = window) {
  const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("isMac", () => {
  it("reads the user agent, and is false with no navigator", () => {
    onMac();
    expect(isMac()).toBe(true);
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Windows NT 10.0)" });
    expect(isMac()).toBe(false);
    vi.stubGlobal("navigator", undefined);
    expect(isMac()).toBe(false);
  });
});

describe("isTyping", () => {
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
  };

  it("is true in text fields, textareas, selects and editors", () => {
    expect(isTyping(el("input"))).toBe(true);
    for (const type of ["text", "search", "email", "url", "tel", "password", "number", "date", "time"]) {
      expect(isTyping(el("input", { type }))).toBe(true);
    }
    expect(isTyping(el("textarea"))).toBe(true);
    expect(isTyping(el("select"))).toBe(true);
    const editor = el("div");
    Object.defineProperty(editor, "isContentEditable", { value: true });
    expect(isTyping(editor)).toBe(true);
  });

  it("is false on buttons, checkboxes, the window, and nothing", () => {
    expect(isTyping(el("button"))).toBe(false);
    expect(isTyping(el("input", { type: "checkbox" }))).toBe(false);
    expect(isTyping(el("input", { type: "range" }))).toBe(false);
    expect(isTyping(el("div"))).toBe(false);
    expect(isTyping(window)).toBe(false);
    expect(isTyping(null)).toBe(false);
  });
});

describe("dispatch", () => {
  it("runs a plain key's handler and prevents the default", () => {
    const handler = vi.fn();
    mount(def({ id: "new", keys: ["n"], handler }));
    const e = press("n");
    expect(handler).toHaveBeenCalledWith(e);
    expect(e.defaultPrevented).toBe(true);
  });

  it("matches any of a shortcut's alternative keys", () => {
    const handler = vi.fn();
    mount(def({ id: "down", keys: ["j", "ArrowDown"], handler }));
    press("j");
    press("ArrowDown");
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("tells a letter from its Shift form, ignoring case", () => {
    const plain = vi.fn();
    const shifted = vi.fn();
    mount(def({ id: "a", keys: ["a"], handler: plain }), def({ id: "A", keys: ["shift+a"], handler: shifted }));
    press("A", { shiftKey: true });
    expect([plain.mock.calls.length, shifted.mock.calls.length]).toEqual([0, 1]);
    press("a");
    expect([plain.mock.calls.length, shifted.mock.calls.length]).toEqual([1, 1]);
  });

  it("lets Shift be whatever it takes to type a symbol", () => {
    const handler = vi.fn();
    mount(def({ id: "help", keys: ["?"], handler }));
    press("?", { shiftKey: true });
    press("?");
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("needs Shift to match exactly for named keys", () => {
    const handler = vi.fn();
    mount(def({ id: "down", keys: ["ArrowDown"], handler }));
    press("ArrowDown", { shiftKey: true });
    press("ArrowUp");
    expect(handler).not.toHaveBeenCalled();
    press("ArrowDown");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("needs Alt to match exactly", () => {
    const handler = vi.fn();
    mount(def({ id: "x", keys: ["alt+x"], handler }));
    press("x");
    expect(handler).not.toHaveBeenCalled();
    press("x", { altKey: true });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("reads mod as Ctrl off macOS, and won't take Meta for it", () => {
    const handler = vi.fn();
    mount(def({ id: "k", keys: ["mod+k"], handler }));
    press("k", { metaKey: true });
    press("k");
    expect(handler).not.toHaveBeenCalled();
    press("k", { ctrlKey: true });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("reads mod as Cmd on macOS, where Ctrl is a different shortcut", () => {
    onMac();
    const mod = vi.fn();
    const ctrl = vi.fn();
    mount(def({ id: "k", keys: ["mod+k"], handler: mod }), def({ id: "ck", keys: ["ctrl+k"], handler: ctrl }));
    press("k", { metaKey: true });
    expect([mod.mock.calls.length, ctrl.mock.calls.length]).toEqual([1, 0]);
    press("k", { ctrlKey: true });
    expect([mod.mock.calls.length, ctrl.mock.calls.length]).toEqual([1, 1]);
    press("k", { ctrlKey: true, metaKey: true });
    expect([mod.mock.calls.length, ctrl.mock.calls.length]).toEqual([1, 1]);
  });

  it("treats ctrl like mod off macOS", () => {
    const handler = vi.fn();
    mount(def({ id: "ck", keys: ["ctrl+k"], handler }));
    press("k", { ctrlKey: true });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("skips plain keys while typing, but not mod or alt ones, or allowInInput", () => {
    const plain = vi.fn();
    const mod = vi.fn();
    const alt = vi.fn();
    const escape = vi.fn();
    mount(
      def({ id: "n", keys: ["n"], handler: plain }),
      def({ id: "k", keys: ["mod+k"], handler: mod }),
      def({ id: "x", keys: ["alt+x"], handler: alt }),
      def({ id: "esc", keys: ["Escape"], handler: escape, allowInInput: true }),
    );
    const input = document.body.appendChild(document.createElement("input"));
    const e = press("n", {}, input);
    expect(e.defaultPrevented).toBe(false);
    press("k", { ctrlKey: true }, input);
    press("x", { altKey: true }, input);
    press("Escape", {}, input);
    expect([plain, mod, alt, escape].map((h) => h.mock.calls.length)).toEqual([0, 1, 1, 1]);
  });

  it("runs the most recently registered shortcut for a key first", () => {
    const board = vi.fn();
    const dialog = vi.fn();
    mount(def({ id: "board-esc", keys: ["Escape"], handler: board }));
    renderHook(() => useShortcuts([def({ id: "dialog-esc", keys: ["Escape"], handler: dialog })]));
    press("Escape");
    expect([board.mock.calls.length, dialog.mock.calls.length]).toEqual([0, 1]);
  });

  it("passes the key on when a handler returns false, leaving the default alone if nobody takes it", () => {
    const board = vi.fn();
    mount(def({ id: "board-esc", keys: ["Escape"], handler: board }));
    const dialog = renderHook(() => useShortcuts([def({ id: "dialog-esc", keys: ["Escape"], handler: () => false })]));
    expect(press("Escape").defaultPrevented).toBe(true);
    expect(board).toHaveBeenCalledTimes(1);

    dialog.unmount();
    cleanup();
    mount(def({ id: "only", keys: ["Escape"], handler: () => false }));
    expect(press("Escape").defaultPrevented).toBe(false);
  });

  it("skips a disabled shortcut but keeps it in the list", () => {
    const first = vi.fn();
    const second = vi.fn();
    mount(def({ id: "a", keys: ["s"], handler: first }), def({ id: "b", keys: ["s"], handler: second, enabled: false }));
    const list = renderHook(() => useShortcutList());
    press("s");
    expect([first.mock.calls.length, second.mock.calls.length]).toEqual([1, 0]);
    expect(list.result.current.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("follows the latest render's handler and enabled, keeping the first keys", () => {
    const before = vi.fn();
    const after = vi.fn();
    const hook = mount(def({ id: "r", keys: ["r"], handler: before }));
    hook.rerender({ defs: [def({ id: "r", keys: ["q"], handler: after })] });
    press("q");
    press("r");
    expect([before.mock.calls.length, after.mock.calls.length]).toEqual([0, 1]);
    hook.rerender({ defs: [def({ id: "r", keys: ["r"], handler: after, enabled: false })] });
    press("r");
    expect(after).toHaveBeenCalledTimes(1);
  });

  it("does nothing once a later render drops the shortcut's id", () => {
    const hook = mount(def({ id: "r", keys: ["r"], handler: vi.fn() }));
    hook.rerender({ defs: [] });
    // The entry stays registered but has no handler, which counts as handled.
    expect(press("r").defaultPrevented).toBe(true);
  });

  it("ignores a key something nearer already handled, or an IME is composing", () => {
    const handler = vi.fn();
    mount(def({ id: "n", keys: ["n"], handler }));
    const stop = (e: Event) => e.preventDefault();
    document.addEventListener("keydown", stop);
    press("n", {}, document.body);
    document.removeEventListener("keydown", stop);
    press("n", { isComposing: true });
    expect(handler).not.toHaveBeenCalled();
  });

  it("stops listening when the listener or the shortcuts unmount", () => {
    const handler = vi.fn();
    const listener = renderHook(() => useShortcutListener());
    const shortcuts = renderHook(() => useShortcuts([def({ id: "n", keys: ["n"], handler })]));
    listener.unmount();
    press("n");
    expect(handler).not.toHaveBeenCalled();
    renderHook(() => useShortcutListener());
    shortcuts.unmount();
    press("n");
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("useShortcutList", () => {
  it("lists what's registered without handlers, and updates as components mount and unmount", () => {
    const list = renderHook(() => useShortcutList());
    expect(list.result.current).toEqual([]);
    let board!: ReturnType<typeof renderHook>;
    act(() => {
      board = renderHook(() => useShortcuts([def({ id: "help", keys: ["?", "mod+/"], description: "Shortcuts", group: "General" })]));
    });
    expect(list.result.current).toEqual([{ id: "help", keys: ["?", "mod+/"], description: "Shortcuts", group: "General" }]);
    act(() => board.unmount());
    expect(list.result.current).toEqual([]);
  });

  it("returns the same list between changes", () => {
    renderHook(() => useShortcuts([def({ id: "n", keys: ["n"] })]));
    const list = renderHook(() => useShortcutList());
    const first = list.result.current;
    list.rerender();
    expect(list.result.current).toBe(first);
  });

  it("is empty when rendered on the server", () => {
    let seen: unknown;
    function Probe() {
      seen = useShortcutList();
      return null;
    }
    renderToString(createElement(Probe));
    expect(seen).toEqual([]);
  });
});

describe("useShortcutHint", () => {
  it("adds a registered shortcut's first key to a label", () => {
    renderHook(() => useShortcuts([def({ id: "copilot", keys: ["c"] }), def({ id: "find", keys: ["mod+k", "/"] })]));
    const hint = renderHook(() => useShortcutHint()).result.current;
    expect(hint("copilot", "Copilot")).toBe("Copilot (C)");
    expect(hint("find", "Find")).toBe("Find (Ctrl+K)");
  });

  it("leaves the label alone for an id that isn't registered", () => {
    const hint = renderHook(() => useShortcutHint()).result.current;
    expect(hint("nope", "Nope")).toBe("Nope");
  });
});

describe("keyCaps and keyLabel", () => {
  it("draws modifiers in Apple's ⌃⌥⇧⌘ order on macOS", () => {
    expect(keyCaps("mod+k", true)).toEqual(["⌘", "K"]);
    expect(keyCaps("mod+shift+alt+ctrl+x", true)).toEqual(["⌃", "⌥", "⇧", "⌘", "X"]);
    expect(keyLabel("shift+mod+z", true)).toBe("⇧⌘Z");
  });

  it("spells modifiers out elsewhere, with mod and ctrl both Ctrl", () => {
    expect(keyCaps("mod+k", false)).toEqual(["Ctrl", "K"]);
    expect(keyCaps("ctrl+alt+shift+x", false)).toEqual(["Ctrl", "Alt", "Shift", "X"]);
    expect(keyLabel("mod+shift+z", false)).toBe("Ctrl+Shift+Z");
  });

  it("names special keys and keeps other named keys as written", () => {
    expect(keyCaps("ArrowDown", false)).toEqual(["↓"]);
    expect(keyCaps("Escape", false)).toEqual(["Esc"]);
    expect(keyCaps("Backspace", false)).toEqual(["⌫"]);
    expect(keyCaps("ctrl+alt+ ", true)).toEqual(["⌃", "⌥", "Space"]);
    expect(keyCaps("Home", false)).toEqual(["Home"]);
  });

  it("reads a trailing + as the plus key", () => {
    expect(keyCaps("mod++", true)).toEqual(["⌘", "+"]);
    expect(keyCaps("+", false)).toEqual(["+"]);
  });

  it("follows the platform when not told", () => {
    onMac();
    expect(keyLabel("mod+k")).toBe("⌘K");
    vi.unstubAllGlobals();
    expect(keyLabel("mod+k")).toBe("Ctrl+K");
  });
});

describe("toAccelerator", () => {
  it("writes Electron accelerators", () => {
    expect(toAccelerator("shift+a")).toBe("Shift+A");
    expect(toAccelerator("mod+k")).toBe("CmdOrCtrl+K");
    expect(toAccelerator("ctrl+alt+ArrowUp")).toBe("Ctrl+Alt+Up");
    expect(toAccelerator("mod++")).toBe("CmdOrCtrl+Plus");
    expect(toAccelerator(" ")).toBe("Space");
    expect(toAccelerator("Escape")).toBe("Esc");
    expect(toAccelerator("F5")).toBe("F5");
  });
});

describe("SHORTCUT_GROUPS", () => {
  it("lists General first and App last", () => {
    expect(SHORTCUT_GROUPS[0]).toBe("General");
    expect(SHORTCUT_GROUPS.at(-1)).toBe("App");
  });
});
