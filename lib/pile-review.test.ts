import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchPileReview } from "./pile-review";

const reply = (body: unknown) => vi.fn(() => Promise.resolve(new Response(JSON.stringify(body))));

afterEach(() => vi.unstubAllGlobals());

describe("fetchPileReview", () => {
  it("asks /api/pile for the walk-through prompt of the folder's repo", async () => {
    const fetch = reply({ prompt: "Walk me through…", title: "Commit the uncommitted pile in weft" });
    vi.stubGlobal("fetch", fetch);
    await expect(fetchPileReview("/a b")).resolves.toEqual({ prompt: "Walk me through…", title: "Commit the uncommitted pile in weft" });
    expect(fetch).toHaveBeenCalledWith("/api/pile?cwd=%2Fa%20b&prompt=1");
  });

  it("falls back to a plain title", async () => {
    vi.stubGlobal("fetch", reply({ prompt: "p" }));
    await expect(fetchPileReview("/a")).resolves.toEqual({ prompt: "p", title: "Commit the uncommitted pile" });
  });

  it("rejects with the server's error, or says the tree is clean", async () => {
    vi.stubGlobal("fetch", reply({ error: "boom" }));
    await expect(fetchPileReview("/a")).rejects.toThrow("boom");
    vi.stubGlobal("fetch", reply({ pile: null }));
    await expect(fetchPileReview("/a")).rejects.toThrow("Nothing uncommitted to walk through.");
  });
});
