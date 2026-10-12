import { describe, expect, it } from "vitest";
import { keyCaps, keyLabel, toAccelerator, type ShortcutInfo } from "./hotkeys";
import { filterSections, FIXED_SHORTCUTS, shortcutSections, splitDescription } from "./shortcut-catalog";
import { bindingSpec } from "./shortcuts";

const registered: ShortcutInfo[] = [
  { id: "new-thread", keys: ["n"], description: "New thread", group: "General" },
  { id: "archive", keys: ["shift+a"], description: "Archive or unarchive the open thread", group: "Thread" },
  { id: "card-down", keys: ["j", "ArrowDown"], description: "Next card in the column", group: "Board" },
];

const flat = (sections: ReturnType<typeof shortcutSections>) => sections.flatMap((s) => s.items.map((i) => i.id));

describe("keyCaps", () => {
  it("draws modifiers in Apple's order on macOS", () => {
    expect(keyCaps("mod+shift+b", true)).toEqual(["⇧", "⌘", "B"]);
    expect(keyCaps("ctrl+alt+ ", true)).toEqual(["⌃", "⌥", "Space"]);
  });

  it("spells modifiers out elsewhere, with mod and ctrl both Ctrl", () => {
    expect(keyCaps("mod+k", false)).toEqual(["Ctrl", "K"]);
    expect(keyCaps("ctrl+`", false)).toEqual(["Ctrl", "`"]);
  });

  it("reads a + key and labels arrows", () => {
    expect(keyCaps("mod++", true)).toEqual(["⌘", "+"]);
    expect(keyCaps("ArrowUp", true)).toEqual(["↑"]);
  });
});

describe("keyLabel", () => {
  it("joins caps for a tooltip", () => {
    expect(keyLabel("mod+k", true)).toBe("⌘K");
    expect(keyLabel("mod+k", false)).toBe("Ctrl+K");
    expect(keyLabel("?", true)).toBe("?");
  });
});

describe("shortcutSections", () => {
  it("adds the app menu's key to a registered shortcut on desktop only", () => {
    const desktop = shortcutSections(registered, { desktop: true }).flatMap((s) => s.items);
    expect(desktop.find((i) => i.id === "new-thread")?.keys).toEqual(["n", "mod+n"]);
    const web = shortcutSections(registered, { desktop: false }).flatMap((s) => s.items);
    expect(web.find((i) => i.id === "new-thread")?.keys).toEqual(["n"]);
  });

  it("leaves desktop-only shortcuts out of a browser tab", () => {
    expect(flat(shortcutSections(registered, { desktop: false }))).not.toContain("global-copilot");
    expect(flat(shortcutSections(registered, { desktop: true }))).toContain("global-copilot");
  });

  it("lists groups in order and adds the dictation key", () => {
    const sections = shortcutSections(registered, { desktop: true, dictation: "alt+'" });
    expect(sections.map((s) => s.group)).toEqual(["General", "Board", "Thread", "Writing", "Terminal & browser", "App"]);
    expect(sections.find((s) => s.group === "Writing")?.items.find((i) => i.id === "dictation")?.keys).toEqual(["alt+'"]);
  });

  it("doesn't change the fixed list it reads from", () => {
    const before = FIXED_SHORTCUTS.length;
    shortcutSections(registered, { desktop: true, dictation: "alt+'" });
    expect(FIXED_SHORTCUTS.length).toBe(before);
  });
});

describe("filterSections", () => {
  const sections = shortcutSections(registered, { desktop: true });
  const find = (q: string, mac = true) => flat(filterSections(sections, q, mac));

  it("matches words in the description", () => {
    expect(find("archive")).toEqual(["archive"]);
    expect(find("new THREAD")).toContain("new-thread");
  });

  it("matches a key by name or symbol", () => {
    expect(find("cmd j")).toEqual([]);
    expect(find("⇧a")).toEqual(["archive"]);
    expect(find("shift a")).toContain("archive");
    expect(find("esc")).toContain("close-thread");
    expect(find("j")).toContain("card-down");
  });

  it("finds a menu alias by its combo", () => {
    expect(find("⌘n")).toEqual(["new-thread"]);
    expect(find("ctrl+n", false)).toEqual(["new-thread", "palette-next"]);
  });

  it("returns everything for an empty query", () => {
    expect(filterSections(sections, "  ", true)).toBe(sections);
  });
});

describe("bindingSpec", () => {
  it("turns a stored binding into a key spec", () => {
    expect(bindingSpec({ code: "Quote", alt: true, ctrl: false, meta: false, shift: false }, true)).toBe("alt+'");
    expect(bindingSpec({ code: "KeyD", alt: false, ctrl: false, meta: true, shift: true }, true)).toBe("shift+mod+d");
    expect(keyCaps(bindingSpec({ code: "Space", alt: false, ctrl: true, meta: false, shift: false }, true), true)).toEqual(["⌃", "Space"]);
  });
});

describe("toAccelerator", () => {
  it("turns a key spec into an Electron accelerator", () => {
    expect(toAccelerator("shift+a")).toBe("Shift+A");
    expect(toAccelerator("mod+k")).toBe("CmdOrCtrl+K");
    expect(toAccelerator("Enter")).toBe("Enter");
    expect(toAccelerator("ctrl+alt+ ")).toBe("Ctrl+Alt+Space");
    expect(toAccelerator("ArrowDown")).toBe("Down");
  });
});

describe("splitDescription", () => {
  it("moves a trailing parenthetical into the detail", () => {
    expect(splitDescription("Stop the running turn (in the reply box)")).toEqual({
      main: "Stop the running turn",
      detail: "in the reply box",
    });
  });

  it("splits at the first colon", () => {
    expect(splitDescription("Library: recipes, to-dos and notes")).toEqual({ main: "Library", detail: "recipes, to-dos and notes" });
  });

  it("prefers the parenthetical when both appear", () => {
    expect(splitDescription("Send a reply later (Enter again: at the 5-hour reset)")).toEqual({
      main: "Send a reply later",
      detail: "Enter again: at the 5-hour reset",
    });
  });

  it("leaves a plain description whole", () => {
    expect(splitDescription("Bold")).toEqual({ main: "Bold" });
  });
});
