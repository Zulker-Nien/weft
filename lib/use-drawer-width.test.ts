// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { DRAWER_WIDTH, clampDrawerWidth, savedDrawerWidth, useDrawerWidth } from "./use-drawer-width";

describe("clampDrawerWidth", () => {
  it("keeps the width between the bounds", () => {
    expect(clampDrawerWidth(100)).toBe(DRAWER_WIDTH.min);
    expect(clampDrawerWidth(5000)).toBe(DRAWER_WIDTH.max);
    expect(clampDrawerWidth(300.4)).toBe(300);
  });
  it("leaves 360px of the window for the board", () => {
    expect(clampDrawerWidth(600, 800)).toBe(440);
  });
});

describe("useDrawerWidth", () => {
  beforeEach(() => localStorage.clear());

  it("starts at the default, or the saved width", () => {
    expect(savedDrawerWidth()).toBe(DRAWER_WIDTH.default);
    localStorage.setItem("weft.railDrawerWidth", "400");
    expect(renderHook(() => useDrawerWidth()).result.current.width).toBe(400);
  });

  it("follows a drag and remembers where it ended", () => {
    const { result } = renderHook(() => useDrawerWidth());
    act(() => result.current.startDrag({ clientX: 100, preventDefault() {} } as React.PointerEvent));
    act(() => {
      window.dispatchEvent(new MouseEvent("pointermove", { clientX: 180 }));
    });
    expect(result.current.width).toBe(DRAWER_WIDTH.default + 80);
    expect(document.body.style.cursor).toBe("col-resize");
    act(() => {
      window.dispatchEvent(new MouseEvent("pointerup"));
    });
    expect(document.body.style.cursor).toBe("");
    expect(localStorage.getItem("weft.railDrawerWidth")).toBe(String(DRAWER_WIDTH.default + 80));
  });

  it("resets to the default on a double-click", () => {
    localStorage.setItem("weft.railDrawerWidth", "500");
    const { result } = renderHook(() => useDrawerWidth());
    act(() => result.current.reset());
    expect(result.current.width).toBe(DRAWER_WIDTH.default);
    expect(localStorage.getItem("weft.railDrawerWidth")).toBe(String(DRAWER_WIDTH.default));
  });
});
