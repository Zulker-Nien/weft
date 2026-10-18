// @vitest-environment happy-dom
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearLinkedStatusCache } from "./use-linked-status";
import { useVercel } from "./use-vercel";

const status = { signedIn: true, user: { username: "me" }, error: null, folders: [] };

afterEach(() => {
  cleanup();
  clearLinkedStatusCache();
  delete (window as unknown as { weft?: unknown }).weft;
});

// The loading and caching are lib/use-linked-status.test.ts's; this checks the bridge it asks.
describe("useVercel", () => {
  it("asks main's vercel bridge for the folders' status", async () => {
    const bridge = { status: vi.fn(() => Promise.resolve(status)) };
    (window as unknown as { weft: unknown }).weft = { vercel: bridge };
    const { result } = renderHook(() => useVercel(["/a"], true));
    await waitFor(() => expect(result.current.status).toEqual(status));
    expect(bridge.status).toHaveBeenCalledWith(["/a"]);
  });
});
