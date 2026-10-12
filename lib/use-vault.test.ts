// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { addSecret, onSecretAsk, useIdle, useVault } from "./use-vault";

const overview = { vaults: [], unlocked: false };

function shell(overviewFn: (folders: string[]) => Promise<unknown>) {
  const bridge = { overview: vi.fn(overviewFn) };
  (window as unknown as { threadboard: unknown }).threadboard = { vault: bridge };
  return bridge;
}

afterEach(() => {
  cleanup();
  delete (window as unknown as { threadboard?: unknown }).threadboard;
  vi.useRealTimers();
});

describe("useVault", () => {
  it("does nothing outside the desktop shell or with no folders", async () => {
    const { result } = renderHook(() => useVault(["/p"]));
    await act(() => result.current.reload());
    expect(result.current).toMatchObject({ bridge: null, overview: null, error: null });
    const bridge = shell(() => Promise.resolve(overview));
    renderHook(() => useVault([]));
    expect(bridge.overview).not.toHaveBeenCalled();
  });

  it("loads again when main says a managed .env.local was edited", async () => {
    let changed: (folder: string) => void = () => undefined;
    const stop = vi.fn();
    const bridge = shell(() => Promise.resolve(overview));
    Object.assign(bridge, { onChange: vi.fn((fn: (folder: string) => void) => ((changed = fn), stop)) });
    const { unmount } = renderHook(() => useVault(["/a"]));
    await waitFor(() => expect(bridge.overview).toHaveBeenCalledTimes(1));
    act(() => changed("/a"));
    await waitFor(() => expect(bridge.overview).toHaveBeenCalledTimes(2));
    unmount();
    expect(stop).toHaveBeenCalled();
  });

  it("loads the folders' vaults, again on focus, and reports errors", async () => {
    const bridge = shell(() => Promise.resolve(overview));
    const { result, rerender } = renderHook(({ folders }) => useVault(folders), { initialProps: { folders: ["/a", "/b"] } });
    await waitFor(() => expect(result.current.overview).toEqual(overview));
    expect(bridge.overview).toHaveBeenCalledWith(["/a", "/b"]);
    act(() => void window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(bridge.overview).toHaveBeenCalledTimes(2));
    bridge.overview.mockRejectedValueOnce(new Error("Keychain locked"));
    rerender({ folders: ["/c"] });
    await waitFor(() => expect(result.current.error).toBe("Keychain locked"));
    bridge.overview.mockRejectedValueOnce("plain");
    await act(() => result.current.reload());
    expect(result.current.error).toBe("plain");
    await act(() => result.current.reload());
    expect(result.current.error).toBeNull();
  });
});

describe("useIdle", () => {
  it("fires after quiet time, restarts on input, and stays off when inactive", () => {
    vi.useFakeTimers();
    const onIdle = vi.fn();
    const { rerender, unmount } = renderHook(({ active }) => useIdle(active, onIdle, 1000), { initialProps: { active: false } });
    vi.advanceTimersByTime(2000);
    expect(onIdle).not.toHaveBeenCalled();
    rerender({ active: true });
    vi.advanceTimersByTime(900);
    window.dispatchEvent(new Event("pointerdown"));
    vi.advanceTimersByTime(900);
    window.dispatchEvent(new Event("keydown"));
    vi.advanceTimersByTime(900);
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(onIdle).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("uses the default lock time", () => {
    vi.useFakeTimers();
    const onIdle = vi.fn();
    renderHook(() => useIdle(true, onIdle));
    vi.advanceTimersByTime(3 * 60_000);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });
});

describe("addSecret", () => {
  it("opens the drawer and serves the ask now, or once a taker can", () => {
    const open = vi.fn();
    const busy = vi.fn(() => false);
    const stopBusy = onSecretAsk(busy);
    addSecret(open);
    expect(open).toHaveBeenCalledWith("vault");
    expect(busy).toHaveBeenCalledOnce();
    stopBusy();
    const ready = vi.fn(() => true);
    const stopReady = onSecretAsk(ready);
    expect(ready).toHaveBeenCalledOnce();
    addSecret(open);
    expect(ready).toHaveBeenCalledTimes(2);
    stopBusy();
    stopReady();
    addSecret(open);
    expect(ready).toHaveBeenCalledTimes(2);
    const later = vi.fn(() => true);
    onSecretAsk(later)();
    expect(later).toHaveBeenCalledOnce();
  });
});
