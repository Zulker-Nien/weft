import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dir: string;
const g = globalThis as unknown as { __threadboardState?: unknown; __threadboardSettings?: unknown };

async function load() {
  vi.resetModules();
  delete g.__threadboardState;
  delete g.__threadboardSettings;
  return import("./settings");
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-settings-"));
  process.env.THREADBOARD_DATA = dir;
});
afterEach(() => {
  delete g.__threadboardSettings;
  delete g.__threadboardState;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("settings", () => {
  it("starts with the default prompt, no keep-alive and the done automation", async () => {
    const s = await load();
    expect(s.threadPrompt()).toBe(s.DEFAULT_THREAD_PROMPT);
    expect(s.keepAliveMinutes()).toBe(0);
    expect(s.automations()).toEqual([{ id: "default-done", on: "done", skill: "weft:done" }]);
    expect(s.listProjects()).toEqual([]);
  });

  it("the default prompt still asks for the BOARD STATUS line", async () => {
    const s = await load();
    expect(s.DEFAULT_THREAD_PROMPT).toContain("BOARD STATUS: column=");
  });

  it("an empty prompt goes back to the default; a custom one is trimmed and persisted", async () => {
    let s = await load();
    s.setThreadPrompt("  be terse  ");
    expect(s.threadPrompt()).toBe("be terse");
    s = await load();
    expect(s.threadPrompt()).toBe("be terse");
    s.setThreadPrompt("   ");
    expect(s.threadPrompt()).toBe(s.DEFAULT_THREAD_PROMPT);
  });

  it("clamps keep-alive to 0..one week and rounds", async () => {
    const s = await load();
    s.setKeepAliveMinutes(-5);
    expect(s.keepAliveMinutes()).toBe(0);
    s.setKeepAliveMinutes(12.6);
    expect(s.keepAliveMinutes()).toBe(13);
    s.setKeepAliveMinutes(10 ** 9);
    expect(s.keepAliveMinutes()).toBe(7 * 24 * 60);
  });

  it("new threads start in Auto until another default mode is saved", async () => {
    let s = await load();
    expect(s.defaultPermissionMode()).toBe("auto");
    s.setDefaultPermissionMode("acceptEdits");
    s = await load();
    expect(s.defaultPermissionMode()).toBe("acceptEdits");
    expect(s.settingsView().defaultPermissionMode).toBe("acceptEdits");
  });

  it("an empty automations list is kept, not replaced by the defaults", async () => {
    const s = await load();
    s.setAutomations([]);
    expect(s.automations()).toEqual([]);
  });

  it("dismissSession dedupes", async () => {
    const s = await load();
    s.dismissSession("a");
    s.dismissSession("a");
    s.dismissSession("b");
    expect(s.dismissedSessions()).toEqual(["a", "b"]);
  });

  it("dismissedSessions is empty on a fresh state, before any dismiss", async () => {
    const s = await load();
    expect(s.dismissedSessions()).toEqual([]);
  });

  it("dismissSession works when dismissedSessions is not yet set, and the read recovers from a deleted entry", async () => {
    // First dismiss: settings().dismissedSessions is undefined, so the ?? [] inside takes the right.
    let s = await load();
    s.dismissSession("a");
    expect(s.dismissedSessions()).toEqual(["a"]);
    // Reload from disk: the saved array is loaded as defined; the next dismiss takes the left of ??.
    s = await load();
    s.dismissSession("b");
    expect(s.dismissedSessions()).toEqual(["a", "b"]);
  });

  it("the ?? [] fallbacks on the read and the dismiss path run when dismissedSessions was set to null", async () => {
    // The ?? [] on lines 90 and 95 is otherwise dead: settings() initializes the field to []. A legacy
    // settings.json (or a test that resets it) can leave it as null, and the fallbacks should still
    // produce a usable array.
    const s = await load();
    (g as { __threadboardSettings?: { dismissedSessions?: string[] | null } }).__threadboardSettings = {
      dismissedSessions: null,
    };
    expect(s.dismissedSessions()).toEqual([]);
    s.dismissSession("a");
    expect(s.dismissedSessions()).toEqual(["a"]);
  });

  it("touchProject puts the folder first without duplicating; removeProject drops it", async () => {
    const s = await load();
    vi.spyOn(Date, "now").mockReturnValueOnce(1).mockReturnValueOnce(2).mockReturnValueOnce(3);
    s.touchProject("/a");
    s.touchProject("/b");
    s.touchProject("/a");
    expect(s.listProjects().map((p) => p.path)).toEqual(["/a", "/b"]);
    s.removeProject("/a");
    expect(s.listProjects().map((p) => p.path)).toEqual(["/b"]);
    vi.restoreAllMocks();
  });

  it("keeps at most 40 recent projects", async () => {
    const s = await load();
    for (let i = 0; i < 45; i++) s.touchProject(`/p${i}`);
    expect(s.listProjects()).toHaveLength(40);
  });

  it("settings survive a reload and settingsView bundles them", async () => {
    let s = await load();
    s.setKeepAliveMinutes(30);
    s.touchProject("/x");
    s = await load();
    const view = s.settingsView();
    expect(view.keepAliveMinutes).toBe(30);
    expect(view.projects[0].path).toBe("/x");
    expect(view.defaultThreadPrompt).toBe(s.DEFAULT_THREAD_PROMPT);
    expect(fs.existsSync(path.join(dir, "settings.json"))).toBe(true);
  });
});
