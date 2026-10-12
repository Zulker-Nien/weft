// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSupabase } from "./use-supabase";

const status = { signedIn: true, orgs: ["Acme"], error: null, folders: [] };

function shell(statusFn: (folders: string[]) => Promise<unknown>) {
  const bridge = { status: vi.fn(statusFn) };
  (window as unknown as { threadboard: unknown }).threadboard = { supabase: bridge };
  return bridge;
}

afterEach(() => {
  cleanup();
  delete (window as unknown as { threadboard?: unknown }).threadboard;
});

describe("useSupabase", () => {
  it("does nothing outside the desktop shell, with no folders, or while the drawer is shut", async () => {
    const { result } = renderHook(() => useSupabase(["/p"], true));
    await act(() => result.current.reload());
    expect(result.current).toMatchObject({ bridge: null, status: null, error: null });
    const bridge = shell(() => Promise.resolve(status));
    renderHook(() => useSupabase([], true));
    renderHook(() => useSupabase(["/p"], false));
    expect(bridge.status).not.toHaveBeenCalled();
  });

  it("loads when open, again on focus, and reports errors", async () => {
    const bridge = shell(() => Promise.resolve(status));
    const { result, rerender } = renderHook(({ folders }) => useSupabase(folders, true), { initialProps: { folders: ["/a", "/b"] } });
    await waitFor(() => expect(result.current.status).toEqual(status));
    expect(bridge.status).toHaveBeenCalledWith(["/a", "/b"]);
    act(() => void window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(bridge.status).toHaveBeenCalledTimes(2));
    bridge.status.mockRejectedValueOnce(new Error("offline"));
    rerender({ folders: ["/c"] });
    await waitFor(() => expect(result.current.error).toBe("offline"));
    bridge.status.mockRejectedValueOnce("plain");
    await act(() => result.current.reload());
    expect(result.current.error).toBe("plain");
    await act(() => result.current.reload());
    expect(result.current.error).toBeNull();
  });
});
