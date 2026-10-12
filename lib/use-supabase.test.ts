// @vitest-environment happy-dom
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearLinkedStatusCache } from "./use-linked-status";
import { useSupabase } from "./use-supabase";

const status = { signedIn: true, orgs: ["Acme"], error: null, folders: [] };

afterEach(() => {
  cleanup();
  clearLinkedStatusCache();
  delete (window as unknown as { threadboard?: unknown }).threadboard;
});

// The loading and caching are lib/use-linked-status.test.ts's; this checks the bridge it asks.
describe("useSupabase", () => {
  it("asks main's supabase bridge for the folders' status", async () => {
    const bridge = { status: vi.fn(() => Promise.resolve(status)) };
    (window as unknown as { threadboard: unknown }).threadboard = { supabase: bridge };
    const { result } = renderHook(() => useSupabase(["/a"], true));
    await waitFor(() => expect(result.current.status).toEqual(status));
    expect(bridge.status).toHaveBeenCalledWith(["/a"]);
  });
});
