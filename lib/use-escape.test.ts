// @vitest-environment happy-dom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useEscape } from "./use-escape";

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

  it("keeps a panel under a dialog that opened before it", () => {
    const dialog = vi.fn();
    const panel = vi.fn();
    const shown = renderHook(() => useEscape(true, dialog));
    renderHook(() => useEscape(true, panel, { panel: true }));
    press();
    expect(dialog).toHaveBeenCalledOnce();
    expect(panel).not.toHaveBeenCalled();
    shown.unmount();
    press();
    expect(panel).toHaveBeenCalledOnce();
  });

  it("closes the newest panel when no dialog is up", () => {
    const thread = vi.fn();
    const library = vi.fn();
    renderHook(() => useEscape(true, thread, { panel: true }));
    renderHook(() => useEscape(true, library, { panel: true }));
    press();
    expect(library).toHaveBeenCalledOnce();
    expect(thread).not.toHaveBeenCalled();
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
