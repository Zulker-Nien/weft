// @vitest-environment happy-dom
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCloudflare } from "./use-cloudflare";
import { clearLinkedStatusCache } from "./use-linked-status";

const status = { signedIn: true, user: { name: "Acme" }, error: null, folders: [] };

afterEach(() => {
  cleanup();
  clearLinkedStatusCache();
  delete (window as unknown as { weft?: unknown }).weft;
});

// The loading and caching are lib/use-linked-status.test.ts's; this checks the bridge it asks.
describe("useCloudflare", () => {
  it("asks main's cloudflare bridge for the folders' status", async () => {
    const bridge = { status: vi.fn(() => Promise.resolve(status)) };
    (window as unknown as { weft: unknown }).weft = { cloudflare: bridge };
    const { result } = renderHook(() => useCloudflare(["/a"], true));
    await waitFor(() => expect(result.current.status).toEqual(status));
    expect(bridge.status).toHaveBeenCalledWith(["/a"]);
  });
});
