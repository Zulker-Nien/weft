// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { announce, lastFolder, showPage, without } from "./board-helpers";
import type { Card } from "./types";

const card = (over: Partial<Card>) => ({ id: "c1", title: "Fix it", column: "review", ...over }) as Card;

// A stand-in for the browser's Notification, with a settable permission and the last one shown.
function fakeNotification(permission: NotificationPermission) {
  const shown: { message: string; body?: string; onclick?: () => void }[] = [];
  const requestPermission = vi.fn(() => Promise.resolve(permission));
  class FakeNotification {
    static permission = permission;
    static requestPermission = requestPermission;
    onclick?: () => void;
    constructor(message: string, options: { body?: string }) {
      shown.push(Object.assign(this, { message, body: options.body }));
    }
  }
  vi.stubGlobal("Notification", FakeNotification);
  return { shown, requestPermission };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.removeItem("threadboard.cwd");
  delete window.weft;
});

describe("without", () => {
  it("returns a new set without the id, leaving the old one alone", () => {
    const set = new Set(["a", "b"]);
    expect([...without(set, "a")]).toEqual(["b"]);
    expect(set.size).toBe(2);
  });
});

describe("lastFolder", () => {
  it("reads the saved folder, null when there is none or storage throws", () => {
    expect(lastFolder()).toBeNull();
    localStorage.setItem("threadboard.cwd", "/repo");
    expect(lastFolder()).toBe("/repo");
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
    });
    expect(lastFolder()).toBeNull();
  });
});

describe("announce", () => {
  it("shows a notification per column that needs a look, and focuses the app on click", () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    const { shown } = fakeNotification("granted");
    const onClick = vi.fn();
    const focus = vi.spyOn(window, "focus").mockImplementation(() => {});
    announce(card({ column: "needs_you", pending: { title: "Allow Bash?" } as Card["pending"] }), onClick);
    announce(card({ column: "review", lastLine: "All green" }), onClick);
    announce(card({ column: "done" }), onClick);
    expect(shown.map((n) => [n.message, n.body])).toEqual([
      ["Fix it needs you", "Allow Bash?"],
      ["Fix it is ready for review", "All green"],
      ["Fix it is done", ""],
    ]);
    shown[0]?.onclick?.();
    expect(focus).toHaveBeenCalled();
    expect(onClick).toHaveBeenCalled();
  });

  it("says nothing for other columns, while focused, or without the Notification API", () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    const { shown } = fakeNotification("granted");
    announce(card({ column: "running" }), vi.fn());
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    announce(card({}), vi.fn());
    expect(shown).toEqual([]);
    vi.stubGlobal("Notification", undefined);
    expect(() => announce(card({}), vi.fn())).not.toThrow();
  });

  it("asks for permission the first time, and stays quiet once denied", () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    const asked = fakeNotification("default");
    announce(card({}), vi.fn());
    expect(asked.requestPermission).toHaveBeenCalledTimes(1);
    expect(asked.shown).toEqual([]);
    const denied = fakeNotification("denied");
    announce(card({}), vi.fn());
    expect(denied.requestPermission).not.toHaveBeenCalled();
    expect(denied.shown).toEqual([]);
  });
});

describe("showPage", () => {
  it("opens in the board's browser in the desktop app, else a new tab", () => {
    const open = vi.fn(() => Promise.resolve());
    window.weft = { browser: { open } } as unknown as typeof window.weft;
    showPage("https://a.test");
    expect(open).toHaveBeenCalledWith("https://a.test", "board");
    delete window.weft;
    const tab = vi.spyOn(window, "open").mockReturnValue(null);
    showPage("https://b.test");
    expect(tab).toHaveBeenCalledWith("https://b.test", "_blank");
  });
});
