// Type shim for ./app-reload.cjs so the test file (and any future TS importer) gets real types
// instead of `any`. The runtime module is unchanged; only TS uses these declarations.

import * as fsLib from "node:fs";

// The view (Electron's WebContents in production) the reload tracker follows. The test
// injects a fake with `isDestroyed()` and `reloadIgnoringCache()`; the call site that uses
// `reloadIgnoringCache` only runs for non-destroyed views, and `r.track({}, url)` only gets
// a real watch when `url` lands inside an app folder — so every view that reaches reload
// already has the method. `isDestroyed?` is optional because destroyed views shouldn't
// bring in extra fields.
export interface ReloadView {
  isDestroyed?: () => boolean;
  reloadIgnoringCache: () => void;
}

// One reload entry per matched folder; the tracker keeps one watcher per slug. The runtime
// holds this as a plain mutable object, so the type describes both the initial value (the
// watcher, an empty Set and no timer) and the steady-state (any of those set).
export interface ReloadWatcher {
  watcher: fsLib.FSWatcher | null;
  views: Set<ReloadView>;
  timer: ReturnType<typeof setTimeout> | null;
}

// A function-shaped callback that also accepts vitest's `vi.fn()` mocks without a cast.
// vitest's `Mock<T>` distributes its conditional over T = `Procedure | Constructable`, so
// a `Mock<Procedure | Constructable>` resolves to a union of constructable shapes with no
// call signature — a plain `(...args:any[]) => any` won't accept it. The runtime only ever
// calls this; the constructable arm is moot, so the union works in practice.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyFn = ((...args: any[]) => any) | (new (...args: any[]) => any);

export interface AppReload {
  // Returns a teardown the caller holds and calls on navigation-away / destroy. `null`
  // when the URL is outside an app folder or the watcher can't be started.
  track(view: ReloadView, rawUrl: string): (() => void) | null;
  // For tests: how many folders are being watched.
  trackedCount(): number;
}

export function createAppReload(opts: {
  appsDir: string;
  // The watcher's fs. Production passes `import("node:fs")`; tests pass a fake with `watch`.
  fs: {
    watch(folder: string, opts: fsLib.WatchOptions, cb: (event: string, filename: string) => void): fsLib.FSWatcher;
    realpathSync?: (p: string) => string;
  };
  // The setTimeout replacement. Tests inject a collecting fake.
  setTimeout: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>;
  // Called once per debounced change with the view to reload. The view carries its own
  // reloadIgnoringCache, so this function simply forwards.
  reloadIgnoringCache: (view: ReloadView) => void;
  log?: AnyFn;
  // realpathSync. Production pulls it from fs; tests pass `fs.realpathSync` directly so the
  // symlink escapes tests get real fs behaviour. Optional because the runtime falls back to
  // `fs.realpathSync` when this isn't supplied, so a factory whose fs has the method works
  // without it being duplicated here.
  realpathSync?: (p: string) => string;
}): AppReload;

// Decides whether a URL lands inside an app folder under `appsDir/<slug>/`. Returns
// `{ slug, folder }` on match, `null` on a non-file URL, an out-of-apps path, a symlink
// escape, or an unparseable input. Optional realpathSync so callers without one work too.
export function appFolderForUrl(rawUrl: string, appsDir: string, realpathSync?: (p: string) => string): { slug: string; folder: string } | null;

// Turns a file: URL into a path, or null for anything else / unparseable input.
export function urlToFilePath(rawUrl: string): string | null;

// The watched apps folder's path. Honours `WEFT_DATA` so a thread running against a test
// root reloads the right pages.
export function appsDir(): string;

// Wires a WebContentsView to the reload tracker: re-tracks on did-navigate and
// did-navigate-in-page; drops the view on destroyed. Returns nothing — call once per view.
export function attachWebContentsView(view: ReloadView, appReload: AppReload, webContents: {
  on(event: "did-navigate", listener: (_e: unknown, url: string) => void): unknown;
  on(event: "did-navigate-in-page", listener: (_e: unknown, isMainFrame: boolean, url: string) => void): unknown;
  on(event: "destroyed", listener: () => void): unknown;
}): void;
