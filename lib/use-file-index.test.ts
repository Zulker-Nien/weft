// @vitest-environment happy-dom
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { REFRESH_MS, useFileIndex } from "./use-file-index";

afterEach(() => vi.useRealTimers());

describe("useFileIndex", () => {
  it("is null without a listFiles", () => {
    const { result } = renderHook(() => useFileIndex("c1", "/repo", undefined, 0));
    expect(result.current).toBeNull();
  });

  it("builds the index, and re-reads on a new version only after REFRESH_MS", async () => {
    const listFiles = vi.fn().mockResolvedValue(["lib/turn.ts"]);
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const { result, rerender } = renderHook(({ v }) => useFileIndex("c1", "/repo", listFiles, v), { initialProps: { v: 1 } });
    await waitFor(() => expect(result.current?.files.has("lib/turn.ts")).toBe(true));
    rerender({ v: 2 });
    expect(listFiles).toHaveBeenCalledTimes(1);
    now.mockReturnValue(1_000_000 + REFRESH_MS);
    rerender({ v: 3 });
    expect(listFiles).toHaveBeenCalledTimes(2);
    now.mockRestore();
  });

  it("keeps null when the list fails, and ignores a reply after unmount", async () => {
    const failing = vi.fn().mockRejectedValue(new Error("down"));
    const { result } = renderHook(() => useFileIndex("c1", "/repo", failing, 0));
    await waitFor(() => expect(failing).toHaveBeenCalled());
    expect(result.current).toBeNull();

    let resolve: (files: string[]) => void = () => {};
    const slow = vi.fn(() => new Promise<string[]>((r) => (resolve = r)));
    const view = renderHook(() => useFileIndex("c2", "/repo", slow, 0));
    view.unmount();
    resolve(["a.ts"]);
    await Promise.resolve();
    expect(slow).toHaveBeenCalledTimes(1);
  });
});
