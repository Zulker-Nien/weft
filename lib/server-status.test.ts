// @vitest-environment happy-dom
// lib/server-status.ts: the two hooks the Server Error bar draws from. Both read window.weft.server
// lazily inside useEffect (so SSR is safe) and subscribe to the supervisor's pushes. Each test
// installs a fake bridge and drives its callback by hand.

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useServerFatal, useServerStatus } from "./server-status";

// A bridge whose onFatal/onStatus hand back the setter and the unsubscribe, so a test can push a
// value and check the hook followed it, then unmount and check it unsubscribed.
function bridge() {
  let fatal: ((f: { message: string }) => void) | undefined;
  let status: ((s: string) => void) | undefined;
  const stopFatal = vi.fn();
  const stopStatus = vi.fn();
  const b = {
    onFatal: vi.fn((cb: (f: { message: string }) => void) => ((fatal = cb), stopFatal)),
    onStatus: vi.fn((cb: (s: string) => void) => ((status = cb), stopStatus)),
    retry: vi.fn(() => Promise.resolve({ ok: true })),
    logTail: vi.fn(() => Promise.resolve("tail")),
    openLogs: vi.fn(() => Promise.resolve(undefined)),
    createFixCard: vi.fn(() => Promise.resolve(undefined)),
  };
  (window as unknown as { weft: unknown }).weft = { server: b };
  return {
    bridge: b,
    pushFatal: (message: string) => act(() => fatal?.({ message })),
    pushStatus: (text: string) => act(() => status?.(text)),
    stopFatal,
    stopStatus,
  };
}

afterEach(() => {
  cleanup();
  delete (window as unknown as { weft?: unknown }).weft;
});

describe("useServerFatal", () => {
  it("starts null and follows the bridge's server:fatal pushes", () => {
    const { pushFatal } = bridge();
    const { result } = renderHook(() => useServerFatal());
    expect(result.current).toBeNull();
    pushFatal("the dev server died");
    expect(result.current).toEqual({ message: "the dev server died" });
    pushFatal("died again");
    expect(result.current).toEqual({ message: "died again" });
  });

  it("subscribes on mount and unsubscribes on unmount", () => {
    const { bridge: b, stopFatal } = bridge();
    const { unmount } = renderHook(() => useServerFatal());
    expect(b.onFatal).toHaveBeenCalledTimes(1);
    expect(stopFatal).not.toHaveBeenCalled();
    unmount();
    expect(stopFatal).toHaveBeenCalledTimes(1);
  });

  it("does nothing outside the desktop shell (no window.weft)", () => {
    // No bridge installed at all.
    const { result } = renderHook(() => useServerFatal());
    expect(result.current).toBeNull();
  });

  it("does nothing when window.weft has no server bridge", () => {
    (window as unknown as { weft: unknown }).weft = {};
    const { result } = renderHook(() => useServerFatal());
    expect(result.current).toBeNull();
  });
});

describe("useServerStatus", () => {
  it("starts null and follows the supervisor's status pushes", () => {
    const { pushStatus } = bridge();
    const { result } = renderHook(() => useServerStatus());
    expect(result.current).toBeNull();
    pushStatus("Restarting…");
    expect(result.current).toBe("Restarting…");
    pushStatus("Ready");
    expect(result.current).toBe("Ready");
  });

  it("subscribes on mount and unsubscribes on unmount", () => {
    const { bridge: b, stopStatus } = bridge();
    const { unmount } = renderHook(() => useServerStatus());
    expect(b.onStatus).toHaveBeenCalledTimes(1);
    expect(stopStatus).not.toHaveBeenCalled();
    unmount();
    expect(stopStatus).toHaveBeenCalledTimes(1);
  });

  it("does nothing outside the desktop shell (no window.weft)", () => {
    const { result } = renderHook(() => useServerStatus());
    expect(result.current).toBeNull();
  });

  it("does nothing when window.weft has no server bridge", () => {
    (window as unknown as { weft: unknown }).weft = { other: {} };
    const { result } = renderHook(() => useServerStatus());
    expect(result.current).toBeNull();
  });

  it("keeps its own subscription, separate from the fatal hook's", () => {
    const { bridge: b } = bridge();
    renderHook(() => useServerFatal());
    renderHook(() => useServerStatus());
    expect(b.onFatal).toHaveBeenCalledTimes(1);
    expect(b.onStatus).toHaveBeenCalledTimes(1);
  });
});