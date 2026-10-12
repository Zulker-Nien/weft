// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useHeldModifiers, useModHeld } from "./use-mod-held";

const key = (type: "keydown" | "keyup", init: KeyboardEventInit) => act(() => void window.dispatchEvent(new KeyboardEvent(type, init)));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useModHeld", () => {
  it("follows ⌘ on macOS, and lets go when the window loses focus", () => {
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)" });
    const { result } = renderHook(() => useModHeld());
    expect(result.current).toBe(false);
    key("keydown", { key: "Meta", metaKey: true });
    expect(result.current).toBe(true);
    key("keyup", { key: "Meta", metaKey: false });
    expect(result.current).toBe(false);
    key("keydown", { key: "Control", ctrlKey: true });
    expect(result.current).toBe(false);
    key("keydown", { key: "Meta", metaKey: true });
    act(() => void window.dispatchEvent(new Event("blur")));
    expect(result.current).toBe(false);
  });

  it("follows Ctrl elsewhere, and stops listening once unmounted", () => {
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (X11; Linux x86_64)" });
    const { result, unmount } = renderHook(() => useModHeld());
    key("keydown", { key: "Control", ctrlKey: true });
    expect(result.current).toBe(true);
    const remove = vi.spyOn(window, "removeEventListener");
    unmount();
    expect(remove.mock.calls.map(([type]) => type)).toEqual(["keydown", "keyup", "blur"]);
  });
});

describe("useHeldModifiers", () => {
  it("tells ⌘ from ⌃ on macOS, and lets go of both on blur", () => {
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)" });
    const { result } = renderHook(() => useHeldModifiers());
    expect(result.current).toEqual({ mod: false, ctrl: false });
    key("keydown", { key: "Control", ctrlKey: true });
    expect(result.current).toEqual({ mod: false, ctrl: true });
    const before = result.current;
    key("keydown", { key: "Enter", ctrlKey: true });
    expect(result.current).toBe(before);
    key("keydown", { key: "Meta", metaKey: true, ctrlKey: true });
    expect(result.current).toEqual({ mod: true, ctrl: false });
    act(() => void window.dispatchEvent(new Event("blur")));
    expect(result.current).toEqual({ mod: false, ctrl: false });
  });

  it("never reports ⌃ off macOS, where Ctrl is the mod key", () => {
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (X11; Linux x86_64)" });
    const { result } = renderHook(() => useHeldModifiers());
    key("keydown", { key: "Control", ctrlKey: true });
    expect(result.current).toEqual({ mod: true, ctrl: false });
  });
});
