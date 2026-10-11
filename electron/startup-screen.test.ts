import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { createStartupScreen } from "./startup-screen.cjs";

// A stand-in for the main window's webContents: remembers its URL and the scripts run in it.
function fakeView(url = "") {
  const contents = Object.assign(new EventEmitter(), {
    url,
    scripts: [] as string[],
    getURL: () => contents.url,
    loadFile: vi.fn<(file: string, opts: unknown) => Promise<void>>(() => Promise.resolve(void (contents.url = "file:///splash.html"))),
    loadURL: vi.fn((next: string) => Promise.resolve(void (contents.url = next))),
    executeJavaScript: vi.fn((js: string) => Promise.resolve(void contents.scripts.push(js))),
  });
  return { webContents: contents };
}

function setup(url = "", logPath?: string) {
  const view = fakeView(url);
  const showMain = vi.fn();
  const screen = createStartupScreen({ view: () => view, version: "1.2.3", showMain, logPath: () => logPath });
  return { view, contents: view.webContents, showMain, screen };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("startup screen", () => {
  it("loads the splash once and sets its status", async () => {
    const { contents, screen } = setup();
    await screen.show("Starting the board…");
    await screen.show("Restarting…");
    expect(contents.loadFile).toHaveBeenCalledTimes(1);
    expect(contents.loadFile).toHaveBeenCalledWith(expect.stringMatching(/splash\.html$/), { query: { v: "1.2.3" } });
    expect(contents.scripts).toEqual(['setStatus("Starting the board…")', 'setStatus("Restarting…")']);
  });

  it("shows a failure over the board with where the log is, and brings the window up", async () => {
    const { contents, showMain, screen } = setup("http://127.0.0.1:3000/", "/logs/server.log");
    await screen.fail("The server crashed.");
    expect(showMain).toHaveBeenCalled();
    expect(contents.loadFile).toHaveBeenCalled();
    expect(contents.scripts).toEqual(['showError("The server crashed. Details are in /logs/server.log.")']);
  });

  it("swallows a rejected board load, since did-fail-load reports it", async () => {
    const { contents, screen } = setup();
    contents.loadURL.mockRejectedValueOnce(new Error("ERR_CONNECTION_REFUSED"));
    await expect(screen.loadBoard("http://127.0.0.1:3000")).resolves.toBeUndefined();
  });

  it("shows why the board didn't load, but not for a replaced load, a subframe or the splash", async () => {
    const { contents, screen } = setup("http://127.0.0.1:3000/");
    screen.watch(contents);
    contents.emit("did-fail-load", {}, -3, "ERR_ABORTED", "http://127.0.0.1:3000/", true);
    contents.emit("did-fail-load", {}, -102, "ERR_CONNECTION_REFUSED", "http://127.0.0.1:3000/frame", false);
    contents.emit("did-fail-load", {}, -6, "ERR_FILE_NOT_FOUND", "file:///splash.html", true);
    await tick();
    expect(contents.scripts).toEqual([]);
    contents.emit("did-fail-load", {}, -102, "ERR_CONNECTION_REFUSED", "http://127.0.0.1:3000/", true);
    await tick();
    expect(contents.scripts).toEqual(['showError("The board didn\'t load (ERR_CONNECTION_REFUSED).")']);
  });

  it("shows a crashed renderer, not a clean exit", async () => {
    const { contents, screen } = setup("http://127.0.0.1:3000/");
    screen.watch(contents);
    contents.emit("render-process-gone", {}, { reason: "clean-exit" });
    await tick();
    expect(contents.scripts).toEqual([]);
    contents.emit("render-process-gone", {}, { reason: "crashed" });
    await tick();
    expect(contents.scripts).toEqual(['showError("The board stopped drawing (crashed).")']);
  });
});
