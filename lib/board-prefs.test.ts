// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { setShowBacklog, setShowProgress, showBacklog, showProgress, subscribeBoardPrefs } from "./board-prefs";

afterEach(() => {
  vi.unstubAllGlobals();
  document.cookie = "weft-show-backlog=; path=/; max-age=0";
  document.cookie = "weft-show-progress=; path=/; max-age=0";
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

describe("showProgress", () => {
  it("is on by default and off only once turned off (quiet mode)", () => {
    expect(showProgress()).toBe(true);
    setShowProgress(false);
    expect(document.cookie).toContain("weft-show-progress=0");
    expect(showProgress()).toBe(false);
    setShowProgress(true);
    expect(showProgress()).toBe(true);
  });

  it("is on on the server, where there's no document", () => {
    vi.stubGlobal("document", undefined);
    expect(showProgress()).toBe(true);
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
