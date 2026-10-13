// @vitest-environment happy-dom
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearLinkedStatusCache } from "./use-linked-status";
import { useGithub } from "./use-github";

const status = { account: { login: "me", url: "https://github.com/me" }, error: null, folders: [] };

afterEach(() => {
  cleanup();
  clearLinkedStatusCache();
  vi.unstubAllGlobals();
});

// The loading and caching are lib/use-linked-status.test.ts's; this checks the route it asks.
describe("useGithub", () => {
  it("asks /api/github for the folders' status", async () => {
    const fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify(status))));
    vi.stubGlobal("fetch", fetch);
    const { result } = renderHook(() => useGithub(["/a", "/b c"], true));
    await waitFor(() => expect(result.current.status).toEqual(status));
    expect(fetch).toHaveBeenCalledWith("/api/github?folder=%2Fa&folder=%2Fb+c", expect.objectContaining({ method: "GET" }));
  });
});
