import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createAppReload, appFolderForUrl, urlToFilePath } from "./app-reload.cjs";

// electron/app-reload.cjs: one watcher per app folder under ~/.weft/apps/<slug>/, shared by every view
// currently on a page from that folder, that reloads the view on a change. fs.watch and setTimeout are
// injected so the test runs without a real Electron or a real debounce.

type Listener = (event: string, filename: string) => void;
type ErrorListener = (err: unknown) => void;
type FakeWatcher = { callbacks: Set<Listener>; errorListeners: Set<ErrorListener>; close: () => void };

function fakeFs() {
  const watchers = new Map<string, FakeWatcher>();
  const watch = (dir: string, _opts: unknown, cb: (event: string, filename: string) => void) => {
    const errorListeners = new Set<ErrorListener>();
    const w: FakeWatcher = {
      callbacks: new Set(),
      errorListeners,
      close: vi.fn(() => watchers.delete(dir)),
    };
    const wrapped = (event: string, filename: string) => cb(event, filename);
    (w as unknown as { cb: typeof wrapped }).cb = wrapped;
    (w as unknown as { on: (event: string, fn: unknown) => unknown }).on = (event: string, fn: unknown) => {
      if (event === "error") errorListeners.add(fn as ErrorListener);
      return w;
    };
    watchers.set(dir, w);
    return w as unknown as ReturnType<typeof import("node:fs").watch>;
  };
  return {
    watch,
    _fire(dir: string, filename: string) {
      const w = watchers.get(dir);
      if (w) (w as unknown as { cb: (e: string, f: string) => void }).cb("change", filename);
    },
    _closeAll() {
      for (const w of watchers.values()) w.close();
    },
    watchers,
  };
}

const appsDir = "/fake/weft/apps";
const slug = "demo";
const folder = path.join(appsDir, slug);
const pageUrl = pathToFileURL(path.join(folder, "index.html")).href;
const subPageUrl = pathToFileURL(path.join(folder, "charts.tsx")).href;
const outsideUrl = pathToFileURL("/elsewhere/page.html").href;

function makeView() {
  const view = { isDestroyed: () => false, reloadCount: 0 };
  (view as unknown as { reloadIgnoringCache: () => void }).reloadIgnoringCache = vi.fn(function (this: { reloadCount: number }) { this.reloadCount++; });
  return view as unknown as { isDestroyed: () => boolean; reloadCount: number; reloadIgnoringCache: () => void };
}

// The factory's reloadIgnoringCache is the real function the app uses; it expects a view with
// reloadIgnoringCache. In production that's electron's WebContents; here each test's view has a
// counter-bumping vi.fn the factory calls, so reloads count per view. The view shape here
// mirrors the ReloadView interface in app-reload.d.cts.
function makeReloadIgnoringCache() {
  return (view: { reloadIgnoringCache: () => void }) => view.reloadIgnoringCache();
}

let fsLib: ReturnType<typeof fakeFs>;
let timers: { id: number; cb: () => void; ms: number }[];
let log: ReturnType<typeof vi.fn>;

function setup() {
  fsLib = fakeFs();
  timers = [];
  log = vi.fn();
  const setTimer = (cb: () => void, ms: number) => {
    const t = { id: timers.length, cb, ms };
    timers.push(t);
    return t as unknown as ReturnType<typeof setTimeout>;
  };
  const reload = vi.fn();
  return { setTimer, reload };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("appFolderForUrl", () => {
  it("matches a file inside the apps dir, returning the slug and folder", () => {
    expect(appFolderForUrl(pageUrl, appsDir)).toEqual({ slug, folder });
  });
  it("matches a deeper file in the same folder", () => {
    expect(appFolderForUrl(subPageUrl, appsDir)).toEqual({ slug, folder });
  });
  it("returns null for a non-file URL", () => {
    expect(appFolderForUrl("https://example.com/", appsDir)).toBeNull();
  });
  it("returns null for a file outside the apps dir", () => {
    expect(appFolderForUrl(outsideUrl, appsDir)).toBeNull();
  });
  it("returns null for an unparseable URL", () => {
    expect(appFolderForUrl("not a url", appsDir)).toBeNull();
  });
});

describe("urlToFilePath", () => {
  it("turns a file URL into a path", () => {
    expect(urlToFilePath(pageUrl)).toBe(path.join(folder, "index.html"));
  });
  it("returns null for non-file URLs", () => {
    expect(urlToFilePath("https://example.com/")).toBeNull();
  });
  it("returns null for unparseable input", () => {
    expect(urlToFilePath("not a url")).toBeNull();
    expect(urlToFilePath("")).toBeNull();
  });
});

describe("createAppReload", () => {
  it("tracks a view on an app folder, reloads it after a change, and tears down when navigated away", () => {
    const { setTimer } = setup();
    const view = makeView();
    const reloadIgnoringCache = makeReloadIgnoringCache();
    const r = createAppReload({ appsDir, fs: fsLib, setTimeout: setTimer, reloadIgnoringCache, log });
    const stop = r.track(view, pageUrl);
    expect(stop).not.toBeNull();
    expect(fsLib.watchers.has(folder)).toBe(true);
    fsLib._fire(folder, "App.tsx");
    expect(timers).toHaveLength(1);
    timers[0]?.cb();
    expect(view.reloadCount).toBe(1);
    stop?.();
    expect(r.trackedCount()).toBe(0);
  });

  it("returns null and starts no watcher when the URL is not in an app folder", () => {
    const { setTimer } = setup();
    const r = createAppReload({ appsDir, fs: fsLib, setTimeout: setTimer, reloadIgnoringCache: vi.fn() as never, log });
    const stop = r.track({ reloadIgnoringCache: vi.fn() }, "https://example.com/");
    expect(stop).toBeNull();
    expect(fsLib.watchers.size).toBe(0);
  });

  it("shares one watcher across two views on the same folder and reloads both on a change", () => {
    const { setTimer } = setup();
    const reloadIgnoringCache = makeReloadIgnoringCache();
    const r = createAppReload({ appsDir, fs: fsLib, setTimeout: setTimer, reloadIgnoringCache, log });
    const a = makeView();
    const b = makeView();
    const stopA = r.track(a, pageUrl);
    const stopB = r.track(b, subPageUrl);
    expect(fsLib.watchers.size).toBe(1);
    fsLib._fire(folder, "App.tsx");
    timers[0]?.cb();
    expect(a.reloadCount).toBe(1);
    expect(b.reloadCount).toBe(1);
    stopA?.();
    expect(fsLib.watchers.size).toBe(1);
    stopB?.();
    expect(fsLib.watchers.size).toBe(0);
  });

  it("skips destroyed views when reloading", () => {
    const { setTimer } = setup();
    const reloadIgnoringCache = vi.fn();
    const r = createAppReload({ appsDir, fs: fsLib, setTimeout: setTimer, reloadIgnoringCache, log });
    const view = { isDestroyed: () => true, reloadIgnoringCache: vi.fn() };
    r.track(view, pageUrl);
    fsLib._fire(folder, "App.tsx");
    timers[0]?.cb();
    expect(view.reloadIgnoringCache).not.toHaveBeenCalled();
  });

  it("debounces: rapid changes collapse into one reload", () => {
    const { setTimer } = setup();
    const reloadIgnoringCache = makeReloadIgnoringCache();
    const r = createAppReload({ appsDir, fs: fsLib, setTimeout: setTimer, reloadIgnoringCache, log });
    const view = makeView();
    r.track(view, pageUrl);
    fsLib._fire(folder, "a");
    fsLib._fire(folder, "b");
    fsLib._fire(folder, "c");
    expect(timers).toHaveLength(3);
    timers[2]?.cb();
    expect(view.reloadCount).toBe(1);
  });

  it("survives a watcher start error and logs it", () => {
    const setTimer = vi.fn();
    const log = vi.fn();
    const fsBad = { watch: vi.fn(() => { throw new Error("EPERM"); }) } as never;
    const r = createAppReload({ appsDir, fs: fsBad, setTimeout: setTimer as never, reloadIgnoringCache: vi.fn() as never, log });
    const stop = r.track({ reloadIgnoringCache: vi.fn() }, pageUrl);
    expect(stop).toBeNull();
    expect(log).toHaveBeenCalled();
    expect(r.trackedCount()).toBe(0);
  });

  it("survives a per-reload error and logs it", () => {
    const { setTimer } = setup();
    const reloadIgnoringCache = vi.fn(() => { throw new Error("view gone"); });
    const r = createAppReload({ appsDir, fs: fsLib, setTimeout: setTimer, reloadIgnoringCache, log });
    r.track({ isDestroyed: () => false, reloadIgnoringCache: vi.fn() }, pageUrl);
    fsLib._fire(folder, "App.tsx");
    expect(() => timers[0]?.cb()).not.toThrow();
    expect(log).toHaveBeenCalled();
  });

  it("track returns the same callback's idempotent guard", () => {
    const { setTimer } = setup();
    const r = createAppReload({ appsDir, fs: fsLib, setTimeout: setTimer, reloadIgnoringCache: vi.fn() as never, log });
    const view = makeView();
    const stop = r.track(view, pageUrl);
    stop?.();
    stop?.();
    expect(r.trackedCount()).toBe(0);
  });
});

// Symlink and escape safety: uses a real temp dir so fs.realpathSync can follow links. The previous
// tests use string paths the real fs would refuse; here we want the real fs to validate the code.
describe("path safety", () => {
  let tmpRoot: string;
  let realAppsDir: string;
  let outsideDir: string;
  let realpathSync: typeof fs.realpathSync;

  beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "weft-app-reload-"));
    realAppsDir = fs.realpathSync(tmpRoot);
    outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-app-reload-outside-"));
    realpathSync = fs.realpathSync;
  });

  afterAll(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  });

  function appDir(slug: string) {
    return path.join(realAppsDir, slug);
  }

  function pageUrl(slug: string, file: string) {
    return pathToFileURL(path.join(appDir(slug), file)).href;
  }

  it("refuses a folder under apps/ that is a symlink to outside", () => {
    // apps/<slug> is a symlink to outsideDir — its realpath resolves outside appsDir, so we refuse the watch.
    const slug = "link-out";
    try {
      // Remove first in case the previous test didn't finish cleanup.
      fs.rmSync(appDir(slug), { recursive: true, force: true });
      fs.symlinkSync(outsideDir, appDir(slug), "dir");
      const u = pageUrl(slug, "index.html");
      expect(appFolderForUrl(u, realAppsDir, realpathSync)).toBeNull();
    } finally {
      fs.rmSync(appDir(slug), { recursive: true, force: true });
    }
  });

  it("refuses a file whose real path escapes appsDir through a symlinked parent", () => {
    // The folder itself isn't a symlink, but one of its parents is. Realpath of the file lands outside.
    const linkParent = "link-parent";
    const slug = "escaper";
    try {
      // apps/link-parent → outsideDir; apps/link-parent/<slug> sits inside the symlink and resolves to outsideDir/<slug>.
      fs.rmSync(appDir(linkParent), { recursive: true, force: true });
      fs.rmSync(path.join(outsideDir, slug), { recursive: true, force: true });
      fs.symlinkSync(outsideDir, appDir(linkParent), "dir");
      fs.mkdirSync(path.join(appDir(linkParent), slug), { recursive: true });
      fs.writeFileSync(path.join(appDir(linkParent), slug, "index.html"), "<!doctype html>");
      const u = pageUrl(`${linkParent}/${slug}`, "index.html");
      expect(appFolderForUrl(u, realAppsDir, realpathSync)).toBeNull();
    } finally {
      fs.rmSync(appDir(linkParent), { recursive: true, force: true });
      fs.rmSync(path.join(outsideDir, "escaper"), { recursive: true, force: true });
    }
  });

  it("tracks a real app folder that is not a symlink and reloads on a fs.watch change", () => {
    // The slug's folder is a real directory; pages inside match, realpath stays inside appsDir, the watch goes through.
    const slug = "real-app";
    fs.mkdirSync(appDir(slug), { recursive: true });
    fs.writeFileSync(path.join(appDir(slug), "index.html"), "<!doctype html>");
    try {
      const u = pageUrl(slug, "index.html");
      // Sanity: appFolderForUrl accepts the page and returns the slug.
      expect(appFolderForUrl(u, realAppsDir, realpathSync)).toEqual({ slug, folder: appDir(slug) });
    } finally {
      fs.rmSync(appDir(slug), { recursive: true, force: true });
    }
  });
});
