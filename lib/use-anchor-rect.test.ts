// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAnchorRect } from "./use-anchor-rect";

const flush = () => act(() => new Promise((r) => requestAnimationFrame(() => r(undefined))));

describe("useAnchorRect", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("is null with no selector or no match", async () => {
    expect(renderHook(() => useAnchorRect(null)).result.current).toBeNull();
    const { result } = renderHook(() => useAnchorRect(".missing"));
    await flush();
    expect(result.current).toBeNull();
  });

  it("measures the element and its header, and again on resize", async () => {
    document.body.innerHTML = '<section class="col"><header></header></section><div class="bare"></div>';
    const col = document.querySelector(".col") as HTMLElement;
    col.getBoundingClientRect = () => ({ top: 10, left: 20, width: 260, height: 400 }) as DOMRect;
    (col.firstElementChild as HTMLElement).getBoundingClientRect = () => ({ bottom: 50 }) as DOMRect;
    const { result, unmount } = renderHook(() => useAnchorRect(".col"));
    await flush();
    expect(result.current).toEqual({ top: 10, left: 20, width: 260, height: 400, headerBottom: 50 });
    col.getBoundingClientRect = () => ({ top: 10, left: 90, width: 260, height: 400 }) as DOMRect;
    window.dispatchEvent(new Event("resize"));
    await flush();
    expect(result.current?.left).toBe(90);
    const kept = result.current;
    window.dispatchEvent(new Event("resize"));
    await flush();
    expect(result.current).toBe(kept);
    unmount();
    const bare = renderHook(() => useAnchorRect(".bare"));
    await flush();
    expect(bare.result.current?.headerBottom).toBe(0);
  });

  it("follows a column that moves without resizing", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    document.body.innerHTML = '<div class="m"></div>';
    const el = document.querySelector(".m") as HTMLElement;
    el.getBoundingClientRect = () => ({ top: 0, left: 10, width: 5, height: 5 }) as DOMRect;
    const { result, unmount } = renderHook(() => useAnchorRect(".m"));
    await flush();
    el.getBoundingClientRect = () => ({ top: 0, left: 300, width: 5, height: 5 }) as DOMRect;
    vi.advanceTimersByTime(500);
    await flush();
    expect(result.current?.left).toBe(300);
    unmount();
    vi.useRealTimers();
  });

  it("works without ResizeObserver", async () => {
    vi.stubGlobal("ResizeObserver", undefined);
    document.body.innerHTML = '<div class="x"></div>';
    const { result } = renderHook(() => useAnchorRect(".x"));
    await flush();
    expect(result.current).not.toBeNull();
  });
});
