import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { compareVersions, createUpdater, FIRST_CHECK_MS, menuItem, newerRelease } from "./updater.cjs";

function feed(version: string, notes = "### Added\n- things") {
  return {
    currentRelease: version,
    releases: [{ version, updateTo: { version, notes, url: `https://example.test/Weft-${version}-arm64.zip` } }],
    page: `https://example.test/releases/tag/v${version}`,
  };
}

// Squirrel stand-in: records the feed it was given and lets a test fire its events.
function fakeSquirrel() {
  const emitter = new EventEmitter() as EventEmitter & Record<string, ReturnType<typeof vi.fn>>;
  emitter.setFeedURL = vi.fn();
  emitter.checkForUpdates = vi.fn();
  emitter.quitAndInstall = vi.fn();
  return emitter;
}

function make(over: Record<string, unknown> = {}) {
  const squirrel = fakeSquirrel();
  const calls = { tell: vi.fn(), notify: vi.fn(), openExternal: vi.fn(), onBeforeInstall: vi.fn(), onChange: vi.fn() };
  const updater = createUpdater({
    currentVersion: "0.3.0",
    packaged: true,
    autoUpdater: squirrel,
    fetchJson: () => Promise.resolve(feed("0.4.0")),
    log: { ...console, warn: () => {} },
    ...calls,
    ...over,
  });
  return { updater, squirrel, ...calls };
}

afterEach(() => vi.useRealTimers());

describe("compareVersions", () => {
  it("orders by major, minor, patch", () => {
    expect(compareVersions("0.4.0", "0.3.9")).toBe(1);
    expect(compareVersions("0.3.0", "0.3.0")).toBe(0);
    expect(compareVersions("1.0.0", "1.0.1")).toBe(-1);
    expect(compareVersions("v0.10.0", "0.9.0")).toBe(1);
  });

  it("puts a prerelease before its release", () => {
    expect(compareVersions("0.4.0-beta.1", "0.4.0")).toBe(-1);
    expect(compareVersions("0.4.0", "0.4.0-beta.1")).toBe(1);
    expect(compareVersions("0.4.0-beta.2", "0.4.0-beta.1")).toBe(1);
    expect(compareVersions("0.4.0-beta.1", "0.4.0-beta.2")).toBe(-1);
    expect(compareVersions("0.4.0-rc", "0.4.0-rc")).toBe(0);
  });

  it("reads missing or junk parts as 0", () => {
    expect(compareVersions("1", "1.0.0")).toBe(0);
    expect(compareVersions("1.x", "1.0.0")).toBe(0);
  });
});

describe("newerRelease", () => {
  it("returns the feed's release when it's newer, with notes and page", () => {
    expect(newerRelease(feed("0.4.0", "notes"), "0.3.0")).toEqual({ version: "0.4.0", notes: "notes", page: "https://example.test/releases/tag/v0.4.0" });
  });

  it("is null for the same or an older version", () => {
    expect(newerRelease(feed("0.3.0"), "0.3.0")).toBeNull();
    expect(newerRelease(feed("0.2.0"), "0.3.0")).toBeNull();
  });

  it("is null for a malformed feed", () => {
    expect(newerRelease(null, "0.3.0")).toBeNull();
    expect(newerRelease({ currentRelease: 4 }, "0.3.0")).toBeNull();
  });

  it("falls back to the tag page and empty notes", () => {
    expect(newerRelease({ currentRelease: "0.4.0" }, "0.3.0")).toEqual({
      version: "0.4.0",
      notes: "",
      page: "https://github.com/aimhuge/weft/releases/tag/v0.4.0",
    });
  });
});

describe("menuItem", () => {
  const actions = { install: () => {}, download: () => {}, check: () => {} };
  it("labels each phase", () => {
    expect(menuItem({ phase: "ready", version: "0.4.0" }, actions)).toMatchObject({ label: "Restart to Update to 0.4.0", click: actions.install });
    expect(menuItem({ phase: "downloading", version: "0.4.0" }, actions)).toMatchObject({ label: "Downloading Weft 0.4.0…", enabled: false });
    expect(menuItem({ phase: "available", version: "0.4.0" }, actions)).toMatchObject({ label: "Download Weft 0.4.0…", click: actions.download });
    expect(menuItem({ phase: "checking" }, actions)).toMatchObject({ label: "Checking for Updates…", enabled: false });
    expect(menuItem({ phase: "idle" }, actions)).toMatchObject({ label: "Check for Updates…", click: actions.check });
  });
});

describe("createUpdater", () => {
  it("hands a newer release to Squirrel and offers a restart once it's downloaded", async () => {
    const { updater, squirrel, notify } = make();
    await updater.check();
    expect(squirrel.setFeedURL).toHaveBeenCalledWith({ url: "https://github.com/aimhuge/weft/releases/latest/download/update.json", serverType: "json" });
    expect(squirrel.checkForUpdates).toHaveBeenCalled();
    expect(updater.state()).toMatchObject({ phase: "downloading", version: "0.4.0" });
    squirrel.emit("update-downloaded");
    expect(updater.state()).toMatchObject({ phase: "ready", version: "0.4.0" });
    expect(notify).toHaveBeenCalledWith("Weft 0.4.0 is ready", expect.any(String));
    expect(updater.menuItem().label).toBe("Restart to Update to 0.4.0");
  });

  it("sets Squirrel's feed and listeners only once", async () => {
    const { updater, squirrel } = make();
    await updater.check();
    squirrel.emit("error", new Error("Could not get code signature"));
    await updater.check();
    expect(squirrel.setFeedURL).toHaveBeenCalledTimes(1);
    expect(squirrel.checkForUpdates).toHaveBeenCalledTimes(2);
    expect(squirrel.listenerCount("update-downloaded")).toBe(1);
  });

  it("falls back to the download page when Squirrel fails (an unsigned build)", async () => {
    const { updater, squirrel, openExternal } = make();
    await updater.check();
    squirrel.emit("error", new Error("Could not get code signature for running application"));
    expect(updater.state()).toMatchObject({ phase: "available", version: "0.4.0" });
    (updater.menuItem() as { click: () => void }).click();
    expect(openExternal).toHaveBeenCalledWith("https://example.test/releases/tag/v0.4.0");
  });

  it("ignores Squirrel errors when it isn't downloading", async () => {
    const { updater, squirrel } = make();
    await updater.check();
    squirrel.emit("update-downloaded");
    squirrel.emit("error", new Error("late"));
    expect(updater.state().phase).toBe("ready");
  });

  it("falls back when checkForUpdates throws", async () => {
    const squirrel = fakeSquirrel();
    squirrel.checkForUpdates = vi.fn(() => {
      throw new Error("no feed");
    });
    const { updater } = make({ autoUpdater: squirrel });
    await updater.check();
    expect(updater.state().phase).toBe("available");
  });

  it("offers the download without Squirrel in an unpackaged run", async () => {
    const { updater, squirrel, tell } = make({ packaged: false });
    await updater.check({ manual: true });
    expect(squirrel.setFeedURL).not.toHaveBeenCalled();
    expect(updater.state()).toMatchObject({ phase: "available", version: "0.4.0" });
    expect(tell).toHaveBeenCalledWith("Weft 0.4.0 is out", expect.any(String));
  });

  it("says you're up to date only when asked", async () => {
    const quiet = make({ fetchJson: () => Promise.resolve(feed("0.3.0")) });
    await quiet.updater.check();
    expect(quiet.updater.state().phase).toBe("idle");
    expect(quiet.tell).not.toHaveBeenCalled();
    const asked = make({ fetchJson: () => Promise.resolve(feed("0.3.0")) });
    await asked.updater.check({ manual: true });
    expect(asked.tell).toHaveBeenCalledWith("You're up to date", "Weft 0.3.0 is the newest version.");
  });

  it("reports a failed check only when asked, and keeps an offer it already had", async () => {
    let fail = false;
    const { updater, tell } = make({
      packaged: false,
      fetchJson: () => (fail ? Promise.reject(new Error("offline")) : Promise.resolve(feed("0.4.0"))),
    });
    await updater.check();
    fail = true;
    await updater.check();
    expect(updater.state().phase).toBe("available");
    expect(tell).not.toHaveBeenCalled();
    await updater.check({ manual: true });
    expect(tell).toHaveBeenCalledWith("Couldn't check for updates", "offline");
  });

  it("goes back to idle after a failed first check", async () => {
    const { updater } = make({ fetchJson: () => Promise.reject(new Error("boom")) });
    await updater.check();
    expect(updater.state().phase).toBe("idle");
  });

  it("doesn't check again while downloading or ready", async () => {
    const fetchJson = vi.fn(() => Promise.resolve(feed("0.4.0")));
    const { updater } = make({ fetchJson });
    await updater.check();
    await updater.check();
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });

  it("restarts into the update, asking first when threads are running", async () => {
    const confirm = vi.fn(() => Promise.resolve(false));
    const { updater, squirrel, onBeforeInstall } = make({ countRunning: () => Promise.resolve(2), confirm });
    expect(await updater.install()).toBe(false); // nothing downloaded yet
    await updater.check();
    squirrel.emit("update-downloaded");
    expect(await updater.install()).toBe(false);
    expect(confirm).toHaveBeenCalledWith("2 threads are still running", expect.any(String));
    expect(squirrel.quitAndInstall).not.toHaveBeenCalled();
    confirm.mockResolvedValue(true);
    expect(await updater.install()).toBe(true);
    expect(onBeforeInstall).toHaveBeenCalled();
    expect(squirrel.quitAndInstall).toHaveBeenCalled();
  });

  it("restarts without asking when nothing is running", async () => {
    const confirm = vi.fn(() => Promise.resolve(true));
    const { updater, squirrel } = make({ countRunning: () => Promise.resolve(0), confirm });
    await updater.check();
    squirrel.emit("update-downloaded");
    expect(await updater.install()).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("restarts when the server can't say what's running", async () => {
    const confirm = vi.fn(() => Promise.resolve(false));
    const { updater, squirrel } = make({ countRunning: () => Promise.reject(new Error("server down")), confirm });
    await updater.check();
    squirrel.emit("update-downloaded");
    expect(await updater.install()).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("says '1 thread is' for a single running thread", async () => {
    const confirm = vi.fn(() => Promise.resolve(true));
    const { updater, squirrel } = make({ countRunning: () => Promise.resolve(1), confirm });
    await updater.check();
    squirrel.emit("update-downloaded");
    await updater.install();
    expect(confirm).toHaveBeenCalledWith("1 thread is still running", expect.any(String));
  });

  it("checks after launch and on a timer, only when packaged", async () => {
    vi.useFakeTimers();
    const fetchJson = vi.fn(() => Promise.resolve(feed("0.3.0")));
    const dev = make({ packaged: false, fetchJson });
    dev.updater.start();
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_MS);
    expect(fetchJson).not.toHaveBeenCalled();

    const app = make({ fetchJson });
    app.updater.start();
    app.updater.start(); // a second start doesn't double the timer
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_MS);
    expect(fetchJson).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1000);
    expect(fetchJson).toHaveBeenCalledTimes(2);
    app.updater.stop();
    await vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1000);
    expect(fetchJson).toHaveBeenCalledTimes(2);
  });

  it("reports every state change", async () => {
    const { updater, onChange } = make({ packaged: false });
    await updater.check();
    expect(onChange.mock.calls.map(([s]) => (s as { phase: string }).phase)).toEqual(["checking", "available"]);
  });

  it("download does nothing without a page", () => {
    const { updater, openExternal } = make();
    updater.download();
    expect(openExternal).not.toHaveBeenCalled();
  });
});
