// @vitest-environment happy-dom
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ShellBridge, StartupResult } from "./client";
import { slowStartupMessage, useStartupCheck } from "./use-startup-check";

const slowest = { name: "page", label: "board page load", ms: 5200 };
const slow: StartupResult = { total: 9400, usual: 3100, slow: true, slowest };

function bridge(startupReady?: () => Promise<StartupResult>) {
  window.threadboard = { startupReady } as unknown as ShellBridge;
}

afterEach(() => {
  delete window.threadboard;
});

describe("slowStartupMessage", () => {
  it("names the total, the usual time and the slowest phase", () => {
    expect(slowStartupMessage(slow)).toBe("Weft took 9.4s to start (usually 3.1s). Slowest: board page load, 5.2s.");
  });

  it("says nothing for a normal launch or without history", () => {
    expect(slowStartupMessage({ ...slow, slow: false })).toBeNull();
    expect(slowStartupMessage({ ...slow, usual: null })).toBeNull();
  });
});

describe("useStartupCheck", () => {
  it("waits for the board to load, then reports once and toasts a slow launch", async () => {
    const ready = vi.fn(() => Promise.resolve(slow));
    bridge(ready);
    const toast = vi.fn();
    const { rerender } = renderHook(({ loaded }) => useStartupCheck(loaded, toast), { initialProps: { loaded: false } });
    expect(ready).not.toHaveBeenCalled();
    rerender({ loaded: true });
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringContaining("9.4s")));
    expect(ready).toHaveBeenCalledTimes(1);
  });

  it("stays quiet after a normal launch", async () => {
    const ready = vi.fn(() => Promise.resolve({ ...slow, slow: false }));
    bridge(ready);
    const toast = vi.fn();
    renderHook(() => useStartupCheck(true, toast));
    await waitFor(() => expect(ready).toHaveBeenCalled());
    expect(toast).not.toHaveBeenCalled();
  });

  it("ignores a failed call, an older shell and a plain browser tab", async () => {
    const toast = vi.fn();
    bridge(() => Promise.reject(new Error("no handler")));
    renderHook(() => useStartupCheck(true, toast));
    bridge();
    renderHook(() => useStartupCheck(true, toast));
    delete window.threadboard;
    renderHook(() => useStartupCheck(true, toast));
    await new Promise((r) => setTimeout(r, 0));
    expect(toast).not.toHaveBeenCalled();
  });
});
