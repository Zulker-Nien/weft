import { describe, expect, it } from "vitest";
import { ago, errorDetail, updateView } from "./update-view.cjs";

const NOW = 1_800_000_000_000;
const view = (state: object, packaged = true) => updateView({ state, currentVersion: "0.3.0", packaged }, NOW);
const actions = (v: { buttons: { action: string }[] }) => v.buttons.map((b) => b.action);

describe("updateView", () => {
  it("before any check, says how often it checks", () => {
    const v = view({ phase: "idle" });
    expect(v).toMatchObject({ tone: "idle", title: "Weft 0.3.0", current: "Weft 0.3.0", checked: "Not checked yet", latest: "" });
    expect(v.detail).toMatch(/every 4 hours/);
    expect(v.buttons).toEqual([{ action: "check", label: "Check Now", primary: true }]);
  });

  it("in dev mode, says git pull updates it", () => {
    const v = view({ phase: "idle" }, false);
    expect(v.current).toBe("Weft 0.3.0 (dev)");
    expect(v.detail).toMatch(/git pull/);
  });

  it("checking disables the button", () => {
    const v = view({ phase: "checking" });
    expect(v.tone).toBe("busy");
    expect(v.buttons).toEqual([{ action: "check", label: "Check Now", disabled: true }]);
  });

  it("up to date, with when it checked", () => {
    const v = view({ phase: "idle", upToDate: true, checkedAt: NOW - 5 * 60_000 });
    expect(v).toMatchObject({ tone: "ok", title: "You're up to date", checked: "Checked 5 min ago" });
  });

  it("a missing feed reads as no release yet", () => {
    const v = view({ phase: "idle", error: "update feed: HTTP 404", checkedAt: NOW });
    expect(v).toMatchObject({ tone: "error", title: "Couldn't check for updates" });
    expect(v.detail).toMatch(/No Weft release is published/);
    expect(actions(v)).toEqual(["releases", "check"]);
  });

  it("downloading lets you close", () => {
    const v = view({ phase: "downloading", version: "0.4.0", notes: "- faster" });
    expect(v).toMatchObject({ tone: "busy", title: "Downloading Weft 0.4.0…", latest: "Weft 0.4.0", notes: "- faster" });
    expect(actions(v)).toEqual(["close"]);
  });

  it("ready offers the restart", () => {
    const v = view({ phase: "ready", version: "0.4.0" });
    expect(v).toMatchObject({ tone: "new", title: "Weft 0.4.0 is ready" });
    expect(v.buttons.at(-1)).toEqual({ action: "install", label: "Restart to Update", primary: true });
  });

  it("available offers the download, worded for packaged and dev", () => {
    expect(view({ phase: "available", version: "0.4.0" }).detail).toMatch(/can't update itself/);
    const dev = view({ phase: "available", version: "0.4.0" }, false);
    expect(dev.detail).toMatch(/git pull/);
    expect(actions(dev)).toEqual(["check", "download"]);
  });
});

describe("errorDetail", () => {
  it("names network failures and passes others through", () => {
    expect(errorDetail("fetch failed")).toMatch(/couldn't be reached/);
    expect(errorDetail("something odd")).toBe("something odd");
  });
});

describe("ago", () => {
  it("reads minutes, hours and days", () => {
    expect(ago(NOW - 10_000, NOW)).toBe("just now");
    expect(ago(NOW - 3 * 3_600_000, NOW)).toBe("3 h ago");
    expect(ago(NOW - 72 * 3_600_000, NOW)).toBe("3 days ago");
  });
});
