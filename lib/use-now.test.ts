// @vitest-environment happy-dom
import { cleanup, renderHook, act } from "@testing-library/react";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNow } from "./use-now";

const START = new Date("2026-10-10T12:00:00Z").getTime();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useNow", () => {
  it("reads the current time once mounted in the browser", () => {
    const { result } = renderHook(() => useNow());
    expect(result.current).toBe(START);
  });

  it("ticks every 30 seconds", () => {
    const { result } = renderHook(() => useNow());
    act(() => {
      vi.advanceTimersByTime(29_999);
    });
    expect(result.current).toBe(START);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe(START + 30_000);
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(result.current).toBe(START + 60_000);
  });

  it("stops ticking once unmounted", () => {
    const { unmount } = renderHook(() => useNow());
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reads 0 during server render, where the current time isn't allowed", () => {
    function Clock() {
      return createElement("span", null, String(useNow()));
    }
    expect(renderToString(createElement(Clock))).toBe("<span>0</span>");
  });
});
