// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useAnyOverlay, useOverlay } from "./overlay";

afterEach(cleanup);

describe("useOverlay and useAnyOverlay", () => {
  it("reports an overlay as up while any active one is mounted", () => {
    const any = renderHook(() => useAnyOverlay());
    expect(any.result.current).toBe(false);

    const a = renderHook(({ active }) => useOverlay(active), { initialProps: { active: true } });
    expect(any.result.current).toBe(true);
    const b = renderHook(() => useOverlay(true));

    act(() => a.unmount());
    expect(any.result.current).toBe(true);
    act(() => b.unmount());
    expect(any.result.current).toBe(false);
  });

  it("follows `active` as it flips", () => {
    const any = renderHook(() => useAnyOverlay());
    const o = renderHook(({ active }) => useOverlay(active), { initialProps: { active: false } });
    expect(any.result.current).toBe(false);
    o.rerender({ active: true });
    expect(any.result.current).toBe(true);
    o.rerender({ active: false });
    expect(any.result.current).toBe(false);
  });

  it("stops notifying a reader once it unmounts", () => {
    const any = renderHook(() => useAnyOverlay());
    any.unmount();
    const o = renderHook(() => useOverlay(true));
    o.unmount();
    expect(any.result.current).toBe(false);
  });
});
