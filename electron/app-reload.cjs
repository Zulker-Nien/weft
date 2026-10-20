// Reloads a pane view whose page lives inside an app folder under ~/.weft/apps/<slug>/ when the folder changes
// (docs/architecture/mini-app-hosting.md). The Mac's own file:// pane can't see the file system, so we watch the
// folder here, in main, and call reloadIgnoringCache() on the view. One watcher per folder, shared by every view
// currently showing a page from that folder: a thread and the board on the same Growth rebuild trigger one reload
// path. The watcher leaves when no view holds a page from that folder anymore. fs and setTimeout are injected so
// the test runs without a real Electron. Path safety: a file:// URL is resolved to a real path (symlinks
// followed), then both the page's real path and the matched folder's real path must live under appsDir's
// real path; the folder itself must not be a symlink, so a watch can never escape ~/.weft/apps/.

const path = require("node:path");
const url = require("node:url");

const RELOAD_DEBOUNCE_MS = 200;

function urlToFilePath(rawUrl) {
  if (!rawUrl) return null;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "file:") return null;
    return url.fileURLToPath(parsed);
  } catch {
    return null;
  }
}

// Realpath with a no-op fallback so the test can pass a stub that doesn't throw on missing files.
function safeRealpath(p, realpath) {
  if (!realpath) return p;
  try {
    return realpath(p);
  } catch {
    return null;
  }
}

// Parses the URL to { slug, folder } when the page is index.html (or App.tsx et al.) directly inside
// ~/.weft/apps/<slug>/. Anything deeper, outside, a symlinked folder, or a page whose real path escapes the
// apps folder is null — the watch is skipped so a hostile page can't make us watch /etc or the user's home.
// Returns the folder, not the file, since the build drops several files in that folder and we want one
// watcher per slug. `realpathSync` is optional so existing callers that don't pass it still work, and the
// test can inject a fake.
function appFolderForUrl(rawUrl, appsDir, realpathSync) {
  const file = urlToFilePath(rawUrl);
  if (!file) return null;
  // Resolve appsDir first: realpathSync(appsDir) follows symlinks at appsDir and parents, so a tmp dir at
  // /var/folders/.../T/... (a /private/var/... symlink on macOS) lines up with the page's real path.
  const realAppsDir = safeRealpath(appsDir, realpathSync);
  if (!realAppsDir) return null;
  const realFile = safeRealpath(file, realpathSync);
  if (!realFile) return null;
  if (!realFile.startsWith(realAppsDir + path.sep)) return null;
  const rel = path.relative(realAppsDir, realFile);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  const parts = rel.split(/[/\\]/).filter(Boolean);
  if (parts.length === 0) return null;
  const slug = parts[0];
  // The folder itself: if it's a symlink (or any of its parents to appsDir) it points elsewhere and
  // fs.watch would follow it, watching outside ~/.weft/apps/. We refuse the watch.
  const folder = path.join(appsDir, slug);
  const realFolder = safeRealpath(folder, realpathSync);
  if (!realFolder) return null;
  if (realFolder !== folder) return null;
  return { slug, folder };
}

function createAppReload({ appsDir, fs: fsLib, setTimeout: setTimer, reloadIgnoringCache, log = () => {}, realpathSync }) {
  // fsLib carries realpathSync too when production passes the real fs; tests inject both. The default
  // fs.realpathSync handles the tmp-dir /private symlink case on macOS automatically.
  const realpath = realpathSync || fsLib?.realpathSync;
  // slug -> { watcher, views:Set<view>, timer }
  const folders = new Map();

  function ensureFolder(folder, slug) {
    const existing = folders.get(slug);
    if (existing) return existing;
    const watcher = {
      watcher: null,
      views: new Set(),
      timer: null,
    };
    try {
      watcher.watcher = fsLib.watch(folder, { recursive: true }, () => {
        if (watcher.timer) clearTimeout(watcher.timer);
        watcher.timer = setTimer(() => {
          watcher.timer = null;
          for (const view of watcher.views) {
            if (view.isDestroyed?.()) continue;
            try {
              reloadIgnoringCache(view);
            } catch (err) {
              log(`reload failed: ${err instanceof Error ? err.message : String(err)}`);
            }
          }
        }, RELOAD_DEBOUNCE_MS);
      });
      watcher.watcher.on("error", (err) => log(`app-reload watcher error: ${err instanceof Error ? err.message : String(err)}`));
    } catch (err) {
      log(`app-reload start failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
    folders.set(slug, watcher);
    return watcher;
  }

  function teardownIfEmpty(slug) {
    const watcher = folders.get(slug);
    if (!watcher) return;
    if (watcher.views.size > 0) return;
    if (watcher.timer) clearTimeout(watcher.timer);
    try {
      watcher.watcher?.close();
    } catch {}
    folders.delete(slug);
  }

  // Called by electron/browser-pane.cjs on did-navigate (and once on did-navigate-in-page). Returns a teardown
  // function the caller holds and calls when the view navigates away, the view is destroyed, or the user
  // navigates the page away from the app folder.
  function track(view, rawUrl) {
    const matched = appFolderForUrl(rawUrl, appsDir, realpath);
    if (!matched) return null;
    const watcher = ensureFolder(matched.folder, matched.slug);
    if (!watcher) return null;
    watcher.views.add(view);
    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      watcher.views.delete(view);
      teardownIfEmpty(matched.slug);
    };
  }

  // For tests: how many folders are being watched.
  function trackedCount() {
    return folders.size;
  }

  return { track, trackedCount };
}

// Resolves the apps folder the build (lib/app-build.ts) and the app-reload logic both watch. Honours WEFT_DATA
// the same way electron/main.cjs's dataDir() does, so a thread running against a test root still reloads the
// right pages. The folder is <weftDir>/apps.
function appsDir() {
  const os = require("node:os");
  const path = require("node:path");
  return path.join(process.env.WEFT_DATA || path.join(os.homedir(), ".weft"), "apps");
}

// Wires a WebContentsView to the reload tracker: a fresh navigation (main-frame or in-page) re-tracks the new
// URL; the previous track's teardown is called so its folder's watcher drops this view; destroyed views also
// drop. Returns nothing — call once per view, right after the view is created.
function attachWebContentsView(view, appReload, webContents) {
  let stop = null;
  const retarget = (url) => {
    if (stop) stop();
    stop = appReload.track(view, url);
  };
  webContents.on("did-navigate", (_e, url) => retarget(url));
  webContents.on("did-navigate-in-page", (_e, _isMainFrame, url) => retarget(url));
  webContents.on("destroyed", () => { if (stop) { stop(); stop = null; } });
}

module.exports = { createAppReload, appFolderForUrl, urlToFilePath, appsDir, attachWebContentsView };