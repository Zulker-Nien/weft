// @vitest-environment happy-dom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ShellBridge } from "./client";
import { useTitleBarZoom } from "./use-title-bar-zoom";

const zoomVar = () => document.documentElement.style.getPropertyValue("--zoom");

afterEach(() => {
  cleanup();
  delete (window as { threadboard?: ShellBridge }).threadboard;
  document.documentElement.style.removeProperty("--zoom");
});

function withZoom(read: () => number) {
  window.threadboard = { zoomFactor: read } as unknown as ShellBridge;
}

describe("useTitleBarZoom", () => {
  it("does nothing in a plain browser tab", () => {
    renderHook(() => useTitleBarZoom());
    expect(zoomVar()).toBe("");
  });

  it("sets --zoom from the page's zoom and follows it on resize", () => {
    let zoom = 0.75;
    withZoom(() => zoom);
    const { unmount } = renderHook(() => useTitleBarZoom());
    expect(zoomVar()).toBe("0.75");
    zoom = 1.25;
    window.dispatchEvent(new Event("resize"));
    expect(zoomVar()).toBe("1.25");
    unmount();
    zoom = 2;
    window.dispatchEvent(new Event("resize"));
    expect(zoomVar()).toBe("1.25");
  });

  it("falls back to 1 when the zoom reads as 0", () => {
    withZoom(vi.fn(() => 0));
    renderHook(() => useTitleBarZoom());
    expect(zoomVar()).toBe("1");
  });
});
