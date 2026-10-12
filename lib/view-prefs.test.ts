// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { readViewPrefs, VIEW_COOKIE, writeViewPrefs } from "./view-prefs";

afterEach(() => {
  document.cookie = `${VIEW_COOKIE}=; path=/; max-age=0`;
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("view prefs", () => {
  it("is empty with nothing saved", () => {
    expect(readViewPrefs()).toEqual({});
  });

  it("reads back the project and sort it wrote, paths and all", () => {
    writeViewPrefs({ project: "/Users/me/dev/my app; v2", sort: "active" });
    expect(readViewPrefs()).toEqual({ project: "/Users/me/dev/my app; v2", sort: "active" });
    writeViewPrefs({ project: null, sort: "newest" });
    expect(readViewPrefs()).toEqual({ project: null, sort: "newest" });
  });

  it("keeps it in a cookie, which every port of localhost shares", () => {
    writeViewPrefs({ project: "/p", sort: "oldest" });
    expect(document.cookie).toContain(`${VIEW_COOKIE}=`);
    expect(localStorage.length).toBe(0);
  });

  it("falls back to the old localStorage copy until the cookie is written", () => {
    localStorage.setItem("threadboard.view", JSON.stringify({ project: "/old", sort: "oldest" }));
    expect(readViewPrefs()).toEqual({ project: "/old", sort: "oldest" });
    writeViewPrefs({ project: "/new", sort: "newest" });
    expect(readViewPrefs()).toEqual({ project: "/new", sort: "newest" });
  });

  it("ignores a cookie or old copy it can't read", () => {
    document.cookie = `${VIEW_COOKIE}=%E0%A4%A; path=/`;
    expect(readViewPrefs()).toEqual({});
    document.cookie = `${VIEW_COOKIE}=${encodeURIComponent("not json")}; path=/`;
    expect(readViewPrefs()).toEqual({});
    document.cookie = `${VIEW_COOKIE}=${encodeURIComponent("42")}; path=/`;
    localStorage.setItem("threadboard.view", "{broken");
    expect(readViewPrefs()).toEqual({});
  });

  it("gets by when localStorage is off", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("denied");
      },
    });
    expect(readViewPrefs()).toEqual({});
  });
});
