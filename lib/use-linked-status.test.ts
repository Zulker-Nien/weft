// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FRESH_MS, clearLinkedStatusCache, useLinkedStatus } from "./use-linked-status";

const status = { signedIn: true, folders: [] };
const bridgeOf = (statusFn: (folders: string[]) => Promise<unknown> = () => Promise.resolve(status)) => ({ status: vi.fn(statusFn) });

afterEach(() => {
  cleanup();
  clearLinkedStatusCache();
  localStorage.clear();
  vi.useRealTimers();
});

describe("useLinkedStatus", () => {
  it("does nothing outside the desktop shell, with no folders, or while the drawer is shut", async () => {
    const { result } = renderHook(() => useLinkedStatus("t", null, ["/p"], true));
    await act(() => result.current.reload());
    expect(result.current).toMatchObject({ bridge: null, status: null, error: null });
    const bridge = bridgeOf();
    renderHook(() => useLinkedStatus("t", bridge, [], true));
    renderHook(() => useLinkedStatus("t", bridge, ["/p"], false));
    expect(bridge.status).not.toHaveBeenCalled();
  });

  it("loads when open, skips a focus while fresh, reloads when stale or the folders change, and reports errors", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const bridge = bridgeOf();
    const { result, rerender } = renderHook(({ folders }) => useLinkedStatus("t", bridge, folders, true), { initialProps: { folders: ["/a", "/b"] } });
    await waitFor(() => expect(result.current.status).toEqual(status));
    expect(bridge.status).toHaveBeenCalledWith(["/a", "/b"]);
    act(() => void window.dispatchEvent(new Event("focus")));
    expect(bridge.status).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + FRESH_MS);
    act(() => void window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(bridge.status).toHaveBeenCalledTimes(2));
    bridge.status.mockRejectedValueOnce(new Error("offline"));
    rerender({ folders: ["/c"] });
    await waitFor(() => expect(result.current.error).toBe("offline"));
    expect(result.current.status).toEqual(status);
    bridge.status.mockRejectedValueOnce("plain");
    await act(() => result.current.reload());
    expect(result.current.error).toBe("plain");
    await act(() => result.current.reload());
    expect(result.current.error).toBeNull();
  });

  it("opens on the last status: from memory without asking, from an earlier run while it asks again", async () => {
    const bridge = bridgeOf();
    const first = renderHook(() => useLinkedStatus("t", bridge, ["/a"], true));
    await waitFor(() => expect(first.result.current.status).toEqual(status));
    first.unmount();
    const again = renderHook(() => useLinkedStatus("t", bridge, ["/a"], true));
    expect(again.result.current.status).toEqual(status);
    expect(bridge.status).toHaveBeenCalledTimes(1);
    again.unmount();
    clearLinkedStatusCache();
    const next = { signedIn: false, folders: [] };
    bridge.status.mockResolvedValueOnce(next);
    const restarted = renderHook(() => useLinkedStatus("t", bridge, ["/a"], true));
    expect(restarted.result.current.status).toEqual(status);
    await waitFor(() => expect(restarted.result.current.status).toEqual(next));
  });

  it("starts empty when storage is unreadable or unwritable", async () => {
    localStorage.setItem("weft:drawer-status:t", "{not json");
    const bridge = bridgeOf();
    const set = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    const { result } = renderHook(() => useLinkedStatus("t", bridge, ["/a"], true));
    expect(result.current.status).toBeNull();
    await waitFor(() => expect(result.current.status).toEqual(status));
    set.mockRestore();
  });
});
