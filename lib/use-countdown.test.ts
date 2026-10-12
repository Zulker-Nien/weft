// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCountdown } from "./use-countdown";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useCountdown", () => {
  it("is null until armed, ticks down to 0, and stops ticking there", () => {
    const { result } = renderHook(() => useCountdown(3000));
    expect(result.current.left).toBeNull();
    act(() => result.current.arm());
    expect(result.current.left).toBe(3000);
    act(() => void vi.advanceTimersByTime(1100));
    expect(result.current.left).toBe(1900);
    act(() => void vi.advanceTimersByTime(5000));
    expect(result.current.left).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("disarms, and starts over when armed again", () => {
    const { result } = renderHook(() => useCountdown(3000));
    act(() => result.current.arm());
    act(() => void vi.advanceTimersByTime(2000));
    act(() => result.current.disarm());
    expect(result.current.left).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    act(() => result.current.arm());
    expect(result.current.left).toBe(3000);
  });
});
