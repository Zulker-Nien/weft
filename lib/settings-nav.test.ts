import { describe, expect, it } from "vitest";
import {
  SETTINGS_NAV,
  firstTab,
  navSectionOf,
  rememberTab,
  rememberedTab,
  sectionOf,
  unsavedSections,
  unsavedTabs,
} from "./settings-nav";

const none = { prompt: false, keepAlive: false, mode: false, backend: false, rules: false };

describe("settings nav", () => {
  it("gives every tab one section", () => {
    const ids = SETTINGS_NAV.flatMap((s) => s.tabs.map((t) => t.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of SETTINGS_NAV)
      for (const t of s.tabs) {
        expect(sectionOf(t.id)).toBe(s.id);
        expect(navSectionOf(t.id)).toBe(s);
      }
  });

  it("opens a section on its first tab unless one is remembered", () => {
    expect(firstTab("threads")).toBe("defaults");
    expect(firstTab("threads", { threads: "subagents" })).toBe("subagents");
  });

  it("marks the tabs and sections with unsaved edits", () => {
    expect(unsavedTabs(none).size).toBe(0);
    expect([...unsavedTabs({ ...none, mode: true })]).toEqual(["defaults"]);
    expect([...unsavedTabs({ ...none, keepAlive: true })]).toEqual(["defaults"]);
    expect([...unsavedTabs({ ...none, backend: true })]).toEqual(["defaults"]);
    const tabs = unsavedTabs({ ...none, prompt: true, rules: true });
    expect([...tabs]).toEqual(["instructions", "rules"]);
    expect([...unsavedSections(tabs)]).toEqual(["threads", "automations"]);
  });

  it("remembers the last tab", () => {
    expect(rememberedTab()).toBe("appearance");
    rememberTab("clis");
    expect(rememberedTab()).toBe("clis");
  });
});
