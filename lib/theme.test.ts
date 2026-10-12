// @vitest-environment happy-dom
import { runInThisContext } from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyTheme, DARK_QUERY, SCENES, savedTheme, sceneOf, sceneUrl, setTheme, THEME_COOKIE, THEME_SCRIPT, THEMES } from "./theme";

function systemDark(dark: boolean) {
  const matchMedia = vi.fn((q: string) => ({ matches: q === DARK_QUERY && dark }));
  vi.stubGlobal("matchMedia", matchMedia);
  return matchMedia;
}

function clearCookie() {
  document.cookie = `${THEME_COOKIE}=; path=/; max-age=0`;
}

beforeEach(() => {
  clearCookie();
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.scene;
});

const root = () => document.documentElement.dataset;
afterEach(() => vi.unstubAllGlobals());

describe("savedTheme", () => {
  it("is system with no cookie", () => {
    expect(savedTheme()).toBe("system");
  });

  it("reads light or dark from the cookie, among others", () => {
    document.cookie = "other=1; path=/";
    document.cookie = `${THEME_COOKIE}=dark; path=/`;
    expect(savedTheme()).toBe("dark");
    document.cookie = `${THEME_COOKIE}=light; path=/`;
    expect(savedTheme()).toBe("light");
  });

  it("ignores a value that isn't light or dark", () => {
    document.cookie = `${THEME_COOKIE}=sepia; path=/`;
    expect(savedTheme()).toBe("system");
  });

  it("reads a scene, but not a value that only starts like one", () => {
    document.cookie = `${THEME_COOKIE}=neon-city; path=/`;
    expect(savedTheme()).toBe("neon-city");
    document.cookie = `${THEME_COOKIE}=darkest; path=/`;
    expect(savedTheme()).toBe("system");
  });

  it("doesn't match a cookie whose name only ends the same", () => {
    document.cookie = `x${THEME_COOKIE}=dark; path=/`;
    expect(savedTheme()).toBe("system");
    document.cookie = `x${THEME_COOKIE}=; path=/; max-age=0`;
  });
});

describe("applyTheme", () => {
  it("follows the system when no theme is saved", () => {
    const mm = systemDark(true);
    applyTheme();
    expect(mm).toHaveBeenCalledWith(DARK_QUERY);
    expect(document.documentElement.dataset.theme).toBe("dark");
    systemDark(false);
    applyTheme();
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("uses the saved theme over the system's, without asking it", () => {
    const mm = systemDark(true);
    document.cookie = `${THEME_COOKIE}=light; path=/`;
    applyTheme();
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(mm).not.toHaveBeenCalled();
  });
});

describe("applyTheme with a scene", () => {
  it("sets the scene and its base palette, without asking the system", () => {
    const mm = systemDark(true);
    document.cookie = `${THEME_COOKIE}=salt-flats; path=/`;
    applyTheme();
    expect(root().theme).toBe("light");
    expect(root().scene).toBe("salt-flats");
    expect(mm).not.toHaveBeenCalled();
  });

  it("clears the scene when you go back to a plain theme", () => {
    setTheme("canyon");
    expect(root()).toMatchObject({ theme: "dark", scene: "canyon" });
    setTheme("light");
    expect(root().theme).toBe("light");
    expect(root().scene).toBeUndefined();
  });
});

describe("setTheme", () => {
  it("saves the choice in a cookie and applies it", () => {
    systemDark(false);
    setTheme("dark");
    expect(savedTheme()).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("goes back to the system's theme for system", () => {
    systemDark(true);
    setTheme("light");
    setTheme("system");
    expect(savedTheme()).toBe("system");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});

describe("THEME_SCRIPT", () => {
  it("does what applyTheme does, before the page paints", () => {
    systemDark(true);
    runInThisContext(THEME_SCRIPT);
    expect(document.documentElement.dataset.theme).toBe("dark");
    document.cookie = `${THEME_COOKIE}=light; path=/`;
    runInThisContext(THEME_SCRIPT);
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("sets a scene and its base the same way, and none for light or dark", () => {
    systemDark(false);
    for (const s of SCENES) {
      document.cookie = `${THEME_COOKIE}=${s.id}; path=/`;
      delete root().scene;
      runInThisContext(THEME_SCRIPT);
      expect(root()).toMatchObject({ theme: s.base, scene: s.id });
    }
    delete root().scene;
    document.cookie = `${THEME_COOKIE}=dark; path=/`;
    runInThisContext(THEME_SCRIPT);
    expect(root().theme).toBe("dark");
    expect(root().scene).toBeUndefined();
  });

  it("swallows errors, e.g. no matchMedia", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(() => { runInThisContext(THEME_SCRIPT); }).not.toThrow();
  });
});

describe("SCENES", () => {
  it("each have a unique id, a jpg and a url", () => {
    expect(new Set(SCENES.map((s) => s.id)).size).toBe(SCENES.length);
    for (const s of SCENES) expect(s.image).toMatch(/\.jpg$/);
    expect(sceneUrl("canyon")).toBe("/api/scenes/canyon");
    expect(sceneOf("canyon")?.label).toBe("Canyon");
    expect(sceneOf("dark")).toBeUndefined();
  });
});

describe("THEMES", () => {
  it("lists system first, then light and dark", () => {
    expect(THEMES.map((t) => t.id)).toEqual(["system", "light", "dark"]);
  });
});
