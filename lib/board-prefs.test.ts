// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { setShowBacklog, showBacklog, subscribeBoardPrefs } from "./board-prefs";

afterEach(() => {
  vi.unstubAllGlobals();
  document.cookie = "weft-show-backlog=; path=/; max-age=0";
});

describe("showBacklog", () => {
  it("is off by default", () => {
    expect(showBacklog()).toBe(false);
  });

  it("follows setShowBacklog through the cookie", () => {
    setShowBacklog(true);
    expect(document.cookie).toContain("weft-show-backlog=1");
    expect(showBacklog()).toBe(true);
    setShowBacklog(false);
    expect(document.cookie).toContain("weft-show-backlog=0");
    expect(showBacklog()).toBe(false);
  });

  it("is off on the server, where there's no document", () => {
    vi.stubGlobal("document", undefined);
    expect(showBacklog()).toBe(false);
  });
});

describe("subscribeBoardPrefs", () => {
  it("tells subscribers about each change until they unsubscribe", () => {
    const onChange = vi.fn();
    const unsubscribe = subscribeBoardPrefs(onChange);
    setShowBacklog(true);
    setShowBacklog(false);
    expect(onChange).toHaveBeenCalledTimes(2);
    unsubscribe();
    setShowBacklog(true);
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});
