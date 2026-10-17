// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSlideOut } from "./use-slide-out";

describe("useSlideOut", () => {
  const vault: { open: string | null } = { open: "vault" };
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("draws nothing while closed", () => {
    const { result } = renderHook(() => useSlideOut<string>(null, 180));
    expect(result.current).toEqual({ shown: null, closing: false });
  });

  it("draws an open panel at once, and a switch to another at once", () => {
    const { result, rerender } = renderHook(({ open }: { open: string | null }) => useSlideOut(open, 180), { initialProps: vault });
    expect(result.current).toEqual({ shown: "vault", closing: false });
    rerender({ open: "services" });
    expect(result.current).toEqual({ shown: "services", closing: false });
  });

  it("keeps a closed panel drawn, closing, for ms, then drops it", () => {
    const { result, rerender } = renderHook(({ open }: { open: string | null }) => useSlideOut(open, 180), { initialProps: vault });
    rerender({ open: null });
    expect(result.current).toEqual({ shown: "vault", closing: true });
    act(() => void vi.advanceTimersByTime(179));
    expect(result.current.shown).toBe("vault");
    act(() => void vi.advanceTimersByTime(1));
    expect(result.current).toEqual({ shown: null, closing: false });
  });

  it("reopening mid-slide cancels the drop", () => {
    const { result, rerender } = renderHook(({ open }: { open: string | null }) => useSlideOut(open, 180), { initialProps: vault });
    rerender({ open: null });
    rerender({ open: "vault" });
    act(() => void vi.advanceTimersByTime(500));
    expect(result.current).toEqual({ shown: "vault", closing: false });
  });
});
