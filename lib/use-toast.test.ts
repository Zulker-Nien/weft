// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useToast } from "./use-toast";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useToast", () => {
  it("starts with no toast", () => {
    const { result } = renderHook(() => useToast());
    expect(result.current.toast).toBeNull();
  });

  it("shows a message with an optional action", () => {
    const { result } = renderHook(() => useToast());
    const undo = { label: "Undo", run: vi.fn() };
    act(() => result.current.setToast("Card archived", undo));
    expect(result.current.toast).toEqual({ text: "Card archived", action: undo });
    act(() => result.current.setToast("Saved"));
    expect(result.current.toast).toEqual({ text: "Saved", action: undefined });
  });

  it("clears with setToast(null)", () => {
    const { result } = renderHook(() => useToast());
    act(() => result.current.setToast("Saved"));
    act(() => result.current.setToast(null));
    expect(result.current.toast).toBeNull();
  });

  it("clears itself after 5 seconds", () => {
    const { result } = renderHook(() => useToast());
    act(() => result.current.setToast("Saved"));
    act(() => vi.advanceTimersByTime(4999));
    expect(result.current.toast).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.toast).toBeNull();
  });

  it("restarts the 5 seconds when a new toast replaces the old one", () => {
    const { result } = renderHook(() => useToast());
    act(() => result.current.setToast("First"));
    act(() => vi.advanceTimersByTime(4000));
    act(() => result.current.setToast("Second"));
    act(() => vi.advanceTimersByTime(4000));
    expect(result.current.toast?.text).toBe("Second");
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.toast).toBeNull();
  });

  it("notify turns an Error into its message", () => {
    const { result } = renderHook(() => useToast());
    act(() => result.current.notify(new Error("Server down")));
    expect(result.current.toast).toEqual({ text: "Server down" });
  });

  it("notify stringifies anything else", () => {
    const { result } = renderHook(() => useToast());
    act(() => result.current.notify("plain text"));
    expect(result.current.toast).toEqual({ text: "plain text" });
    act(() => result.current.notify(404));
    expect(result.current.toast).toEqual({ text: "404" });
  });

  it("keeps setToast and notify stable across renders", () => {
    const { result, rerender } = renderHook(() => useToast());
    const { setToast, notify } = result.current;
    act(() => setToast("Saved"));
    rerender();
    expect(result.current.setToast).toBe(setToast);
    expect(result.current.notify).toBe(notify);
  });

  it("drops its timer when unmounted with a toast up", () => {
    const { result, unmount } = renderHook(() => useToast());
    act(() => result.current.setToast("Saved"));
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
