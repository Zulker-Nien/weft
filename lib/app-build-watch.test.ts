import { afterEach, describe, expect, it, vi } from "vitest";

// lib/app-build-watch.ts: the watcher that rebuilds apps on save. fs and build are injected so the
// test runs without a real filesystem watcher or a real esbuild. The watcher is stored on globalThis,
// so each test resets it; otherwise one test's watcher would leak into the next.

const watchModule = await import("./app-build-watch");

type FakeWatcher = { cb: (event: string, filename: string) => void; close: () => void; errorListeners: Set<(err: unknown) => void> };

function fakeFs() {
  const watcher: FakeWatcher = {
    cb: () => {},
    close: vi.fn(),
    errorListeners: new Set(),
  };
  const fs = {
    mkdirSync: vi.fn(),
    readdirSync: vi.fn(() => [] as Array<{ name: string; isDirectory: () => boolean }>),
    watch: vi.fn((_dir: string, _opts: unknown, cb: (event: string, filename: string) => void) => {
      watcher.cb = cb;
      (watcher as unknown as { on: (e: string, fn: unknown) => unknown }).on = (event: string, fn: unknown) => {
        if (event === "error") watcher.errorListeners.add(fn as (err: unknown) => void);
        return watcher;
      };
      return watcher as unknown as ReturnType<typeof import("node:fs").watch>;
    }),
  };
  return { fs, watcher, fire: (filename: string) => watcher.cb("change", filename), emitError: (err: unknown) => watcher.errorListeners.forEach((fn) => fn(err)) };
}

afterEach(() => {
  watchModule._resetAppBuildWatcherForTests();
  vi.useRealTimers();
});

describe("startAppBuildWatcher", () => {
  it("creates the apps directory if missing and returns a handle", () => {
    const { fs } = fakeFs();
    const build = vi.fn();
    const w = watchModule.startAppBuildWatcher({ fs: fs as never, build, debounceMs: 5 });
    expect(fs.mkdirSync).toHaveBeenCalled();
    expect(w).toBeDefined();
    expect(typeof w.rebuild).toBe("function");
    w.stop();
  });

  it("is idempotent: a second call returns the same handle", () => {
    const { fs } = fakeFs();
    const build = vi.fn();
    const a = watchModule.startAppBuildWatcher({ fs: fs as never, build });
    const b = watchModule.startAppBuildWatcher({ fs: fs as never, build });
    expect(a).toBe(b);
    a.stop();
  });

  it("builds each existing app on start when readBuildInfo returns nothing", async () => {
    const { fs } = fakeFs();
    fs.readdirSync.mockReturnValue([{ name: "alpha", isDirectory: () => true }, { name: "beta", isDirectory: () => true }]);
    const build = vi.fn(() => Promise.resolve({}));
    // readBuildInfo returns undefined for both, so both should be queued.
    vi.spyOn(await import("./app-build"), "readBuildInfo").mockReturnValue(undefined);
    const w = watchModule.startAppBuildWatcher({ fs: fs as never, build, debounceMs: 5 });
    // Wait for the timers to fire.
    await new Promise((r) => setTimeout(r, 30));
    expect(build).toHaveBeenCalledWith("alpha");
    expect(build).toHaveBeenCalledWith("beta");
    w.stop();
  });

  it("debounces multiple changes to the same app into one build", async () => {
    const { fs, fire } = fakeFs();
    fs.readdirSync.mockReturnValue([]);
    const build = vi.fn(() => Promise.resolve({}));
    const w = watchModule.startAppBuildWatcher({ fs: fs as never, build, debounceMs: 10 });
    fire("alpha/App.tsx");
    fire("alpha/App.tsx");
    fire("alpha/App.tsx");
    await new Promise((r) => setTimeout(r, 30));
    expect(build).toHaveBeenCalledTimes(1);
    expect(build).toHaveBeenCalledWith("alpha");
    w.stop();
  });

  it("ignores the build's own outputs (index.html, app.js, app.css, assets/, .weft-build.json, .build/)", async () => {
    const { fs, fire } = fakeFs();
    fs.readdirSync.mockReturnValue([]);
    const build = vi.fn(() => Promise.resolve({}));
    const w = watchModule.startAppBuildWatcher({ fs: fs as never, build, debounceMs: 5 });
    fire("alpha/index.html");
    fire("alpha/app.js");
    fire("alpha/app.css");
    fire("alpha/assets/logo.png");
    fire("alpha/.weft-build.json");
    fire("alpha/.build/entry.js");
    await new Promise((r) => setTimeout(r, 20));
    expect(build).not.toHaveBeenCalled();
    w.stop();
  });

  it("ignores dotfiles and node_modules in the slug path", async () => {
    const { fs, fire } = fakeFs();
    fs.readdirSync.mockReturnValue([]);
    const build = vi.fn(() => Promise.resolve({}));
    const w = watchModule.startAppBuildWatcher({ fs: fs as never, build, debounceMs: 5 });
    fire(".hidden/App.tsx");
    fire("node_modules/react/App.tsx");
    await new Promise((r) => setTimeout(r, 20));
    expect(build).not.toHaveBeenCalled();
    w.stop();
  });

  it("ignores paths outside the apps dir", async () => {
    const { fs, fire } = fakeFs();
    fs.readdirSync.mockReturnValue([]);
    const build = vi.fn(() => Promise.resolve({}));
    const w = watchModule.startAppBuildWatcher({ fs: fs as never, build, debounceMs: 5 });
    fire("../elsewhere/App.tsx");
    await new Promise((r) => setTimeout(r, 20));
    expect(build).not.toHaveBeenCalled();
    w.stop();
  });

  it("exposes a manual rebuild that ignores the debounce", async () => {
    const { fs } = fakeFs();
    fs.readdirSync.mockReturnValue([]);
    const build = vi.fn(() => Promise.resolve({}));
    const w = watchModule.startAppBuildWatcher({ fs: fs as never, build, debounceMs: 5 });
    w.rebuild("alpha");
    await new Promise((r) => setTimeout(r, 20));
    expect(build).toHaveBeenCalledWith("alpha");
    w.stop();
  });

  it("survives a build rejection and logs it", async () => {
    const { fs, fire } = fakeFs();
    fs.readdirSync.mockReturnValue([]);
    const build = vi.fn(() => Promise.reject(new Error("boom")));
    const w = watchModule.startAppBuildWatcher({ fs: fs as never, build, debounceMs: 5 });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fire("alpha/App.tsx");
    await new Promise((r) => setTimeout(r, 30));
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    w.stop();
  });

  it("survives a watcher start error (logs one line, returns a handle anyway)", () => {
    const fs = { mkdirSync: vi.fn(), readdirSync: vi.fn(() => []), watch: vi.fn(() => { throw new Error("EPERM"); }) };
    const build = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const w = watchModule.startAppBuildWatcher({ fs: fs as never, build, debounceMs: 5 });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    w.stop();
  });

  it("survives a watcher error event (logs one line, doesn't crash)", () => {
    const { fs, emitError } = fakeFs();
    const build = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const w = watchModule.startAppBuildWatcher({ fs: fs as never, build, debounceMs: 5 });
    expect(() => emitError(new Error("watcher died"))).not.toThrow();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    w.stop();
  });

  it("stop clears pending timers and closes the watcher", () => {
    const { fs, fire } = fakeFs();
    fs.readdirSync.mockReturnValue([]);
    const build = vi.fn();
    const w = watchModule.startAppBuildWatcher({ fs: fs as never, build, debounceMs: 5 });
    fire("alpha/App.tsx");
    expect(w.pendingCount()).toBe(1);
    w.stop();
    expect(w.pendingCount()).toBe(0);
  });
});
