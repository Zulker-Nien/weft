// @vitest-environment happy-dom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { keepTypedText, useEscape } from "./use-escape";

function press(key = "Escape", init: KeyboardEventInit = {}) {
  const e = new KeyboardEvent("keydown", { key, cancelable: true, ...init });
  window.dispatchEvent(e);
  return e;
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("useEscape", () => {
  it("runs onEscape when Escape is pressed while active", () => {
    const onEscape = vi.fn();
    renderHook(() => useEscape(true, onEscape));
    const e = press();
    expect(onEscape).toHaveBeenCalledWith(e);
    expect(e.defaultPrevented).toBe(true);
  });

  it("does nothing while inactive", () => {
    const onEscape = vi.fn();
    renderHook(() => useEscape(false, onEscape));
    const e = press();
    expect(onEscape).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
  });

  it("ignores other keys and Escape typed mid-composition", () => {
    const onEscape = vi.fn();
    renderHook(() => useEscape(true, onEscape));
    press("Enter");
    press("Escape", { isComposing: true });
    expect(onEscape).not.toHaveBeenCalled();
  });

  it("closes only the layer that became active last", () => {
    const dialog = vi.fn();
    const menu = vi.fn();
    renderHook(() => useEscape(true, dialog));
    const { unmount } = renderHook(() => useEscape(true, menu));
    press();
    expect(menu).toHaveBeenCalledOnce();
    expect(dialog).not.toHaveBeenCalled();
    unmount();
    press();
    expect(dialog).toHaveBeenCalledOnce();
    expect(menu).toHaveBeenCalledOnce();
  });

  it("stacks layers in the order they became active, not mounted", () => {
    const early = vi.fn();
    const late = vi.fn();
    const first = renderHook(({ active }) => useEscape(active, early), { initialProps: { active: false } });
    renderHook(() => useEscape(true, late));
    first.rerender({ active: true });
    press();
    expect(early).toHaveBeenCalledOnce();
    expect(late).not.toHaveBeenCalled();
  });

  it("drops a layer when it goes inactive", () => {
    const below = vi.fn();
    const above = vi.fn();
    renderHook(() => useEscape(true, below));
    const top = renderHook(({ active }) => useEscape(active, above), { initialProps: { active: true } });
    top.rerender({ active: false });
    press();
    expect(below).toHaveBeenCalledOnce();
    expect(above).not.toHaveBeenCalled();
  });

  it("leaves Escape alone once every layer is gone", () => {
    const onEscape = vi.fn();
    const { unmount } = renderHook(() => useEscape(true, onEscape));
    unmount();
    const e = press();
    expect(onEscape).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
  });

  it("calls the latest callback without restacking", () => {
    const below = vi.fn();
    const oldTop = vi.fn();
    const newTop = vi.fn();
    renderHook(() => useEscape(true, below));
    const top = renderHook(({ cb }) => useEscape(true, cb), { initialProps: { cb: oldTop } });
    top.rerender({ cb: newTop });
    press();
    expect(newTop).toHaveBeenCalledOnce();
    expect(oldTop).not.toHaveBeenCalled();
    expect(below).not.toHaveBeenCalled();
  });

  it("lets something closer claim Escape by stopping its propagation", () => {
    const onEscape = vi.fn();
    renderHook(() => useEscape(true, onEscape));
    const input = document.body.appendChild(document.createElement("input"));
    input.addEventListener("keydown", (e) => e.stopPropagation());
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onEscape).not.toHaveBeenCalled();
  });
});

describe("keepTypedText", () => {
  function escapeOn(target: EventTarget) {
    const e = new KeyboardEvent("keydown", { key: "Escape" });
    Object.defineProperty(e, "target", { value: target });
    return e;
  }

  function field<T extends HTMLElement>(el: T): T {
    document.body.appendChild(el);
    el.focus();
    return el;
  }

  it("blurs an input holding text and keeps the dialog open", () => {
    const input = field(document.createElement("input"));
    input.value = "half a prompt";
    expect(keepTypedText(escapeOn(input))).toBe(true);
    expect(document.activeElement).not.toBe(input);
  });

  it("does the same for a textarea", () => {
    const textarea = field(document.createElement("textarea"));
    textarea.value = "notes";
    expect(keepTypedText(escapeOn(textarea))).toBe(true);
    expect(document.activeElement).not.toBe(textarea);
  });

  it("lets an empty or whitespace-only field close", () => {
    const input = field(document.createElement("input"));
    input.value = "   ";
    expect(keepTypedText(escapeOn(input))).toBe(false);
    expect(document.activeElement).toBe(input);
  });

  it("treats a contenteditable editor with text as typed", () => {
    const editor = field(document.createElement("div"));
    editor.contentEditable = "true";
    editor.tabIndex = 0;
    editor.textContent = "draft";
    expect(keepTypedText(escapeOn(editor))).toBe(true);
  });

  it("lets an empty contenteditable editor close", () => {
    const editor = field(document.createElement("div"));
    editor.contentEditable = "true";
    expect(keepTypedText(escapeOn(editor))).toBe(false);
  });

  it("ignores text in an element that isn't editable", () => {
    const div = field(document.createElement("div"));
    div.textContent = "just a label";
    expect(keepTypedText(escapeOn(div))).toBe(false);
  });

  it("returns false when the target isn't an element", () => {
    expect(keepTypedText(escapeOn(window))).toBe(false);
    expect(keepTypedText(new KeyboardEvent("keydown", { key: "Escape" }))).toBe(false);
  });
});
