import { describe, expect, it } from "vitest";
import { SCENES } from "../lib/theme";
import { BASES, themeSource } from "./theme-source.cjs";

describe("themeSource", () => {
  it("follows light and dark as saved", () => {
    expect(themeSource("light")).toBe("light");
    expect(themeSource("dark")).toBe("dark");
  });

  it("follows each scene's base palette, as the board lists them", () => {
    for (const s of SCENES) expect(themeSource(s.id)).toBe(s.base);
    expect(Object.keys(BASES).sort()).toEqual(["dark", "light", ...SCENES.map((s) => s.id)].sort());
  });

  it("follows the system for no cookie, system, or anything unknown", () => {
    expect(themeSource(undefined)).toBe("system");
    expect(themeSource("system")).toBe("system");
    expect(themeSource("toString")).toBe("system");
  });
});
