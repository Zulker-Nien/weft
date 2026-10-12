# Desktop shell

The Electron layer that wraps the Next.js server: the main window, the copilot
window, the side browser pane, the macOS plumbing, and the packaged-server
supervisor.

## `electron/main.cjs`

Boots the app, wires the OS in, and supervises nothing itself — server supervision
lives in `electron/server.cjs`.

- `app.setName("Weft")`, `productName` in `package.json` is "Weft".
- `TOKEN` is a 24-byte random hex string generated once at startup; passed to the
  control server (see below) and to the Next server as `THREADBOARD_SHELL_TOKEN`.
- `PREFERRED_PORT` is `THREADBOARD_PORT` or `1000`. From source, `server.cjs` first runs
  `electron/free-port.cjs`, which kills whatever listens there and deletes the dev build folder
  (`.next`), so a stale server never forces a second port or a shared build folder; the packaged
  app still falls back to a free port when 1000 is taken. (`npm run dev`, the board-only mode without Electron, also
  uses `1000`, so a dev server and the desktop app never collide on different ports.)
- `app.requestSingleInstanceLock()` makes a second `weft` launch just emit
  `second-instance`, which the first process handles by calling `showMain()` and
  routing any `weft://` argument through `handleLink()`.
- `app.on("open-url", …)` is the macOS deep-link entry; in packaged builds the
  `weft` scheme is registered with `app.setAsDefaultProtocolClient("weft")`
  (`build.protocols` in `package.json`).
- `createMainWindow()` builds a hidden `BaseWindow` with `titleBarStyle:
  "hiddenInset"`, mounts a `WebContentsView` (`appView`) as its child, and reveals
  the window on `did-finish-load`. On macOS, `win.on("close", …)` hides instead of
  quits; `quitting` is set in `before-quit`, so ⌘Q actually closes.
- `createCopilot()` creates a second `BrowserWindow` (note: not a `BaseWindow` with a
  child view — it has its own webContents) that loads `${server.url}/copilot`. Same
  close-to-hide behavior so the conversation survives.
- `followThemeChoice()` runs before any window opens. It reads the board's
  `weft-theme` cookie (set from Settings → Appearance; see `lib/theme.ts`) from the
  default session and sets `nativeTheme.themeSource` to match, then keeps watching
  the cookie. Window backgrounds, native menus, and the splash screen follow it.
- `COPILOT_SHORTCUT = "Control+Alt+Space"` is registered with `globalShortcut` at
  startup. If the OS refuses it, a warning is logged.
- The application menu, the context menu (`attachContextMenu`), the tray
  (`createTray` + `updateTray`), the dock menu and badge (`setupDock`,
  `refreshWaiting`), and the splash → main view transition (`boot`, with the splash's
  `startup.show`/`fail`/`loadBoard`/`watch` in `startup-screen.cjs`) are all in this file.
- `weft://` links (`handleLink`):
  - `weft://copilot` → `showCopilot()`
  - `weft://card/<id>` → `sendMenu("open-card", id)`
  - `weft://new?prompt=…&folder=…&title=…&cli=puku&start=1` → POSTs
    `/api/cards` (with `x-threadboard: 1`) and then opens the new card. If
    `folder` is missing, the most recent project's path is read from
    `/api/settings` (falling back to `os.homedir()`).
- IPC handlers at the bottom: `browser:open` (url, card key), `browser:active`, `browser:prune`, `browser:state`, `browser:visible`,
  `browser:bounds`, `browser:back/forward/reload`, `copilot:toggle`,
  `dialog:openFolder`, `shell:openExternal` (http/https only), `shell:reveal` (opens an existing
  absolute folder in Finder), `menu:popup` (shows a native context menu from the items the board
  sends, see `lib/card-menu.ts`, and resolves to the picked item's id or null), `badge:set`, and
  `splash:action` (`retry` re-runs `boot()`; `logs` opens the logs folder; `quit`
  quits).
- `prewarm()` is not called from here — it's called by the Next server from
  `GET /api/cards` (`app/api/cards/route.ts`).

## `electron/server.cjs`

Supervises the Next server. Three run modes, decided by `app.isPackaged` and the
env var `THREADBOARD_PROD`:

- **Dev** (`npm run desktop`): `next dev -H 127.0.0.1 -p <port>` under
  `npm_node_execpath` (the same Node that ran `npm run desktop`). Stdout and
  stderr are also written to the parent's stdout.
- **Start** (`npm run app`): builds into `.next-app`, then runs `next start`, gated on
  `THREADBOARD_PROD=1`.
- **Packaged standalone** (`npm run dist`): the standalone build at
  `process.resourcesPath/server/server.js` is launched as `${name} Helper` (e.g.
  `Weft Helper`) — the helper binary inside `Weft Helper.app/Contents/MacOS/`,
  launched with `ELECTRON_RUN_AS_NODE=1` so it runs as plain Node. Falling back to
  `process.execPath` works too. `NODE_ENV=production`, `PORT=<port>`,
  `HOSTNAME=127.0.0.1`.

`startServer({ preferredPort, env, onStatus, onFatal })`:

- `pickPort(preferred)` returns `preferred` if it's free, else asks the kernel for
  one with `net.createServer().listen(0, "127.0.0.1")`.
- `waitForServer` polls `GET ${url}/api/cards` every 250ms with a 120s timeout.
- On exit, if the process wasn't stopped on purpose and wasn't replaced, the
  supervisor reads the tail of its log and classifies the failure. Two are
  recoverable and don't count toward the crash budget: a "Another next dev
  server is already running" error (a peer dev server in the same project —
  Next 16.4's project-wide guard rejects the new spawn; the supervisor kills
  the named PID and retries), and a "Module not found: Can't resolve 'X'" where
  `X` resolves to a file on disk (a stale Turbopack cache; the supervisor
  `rm -rf .next` and retries). Otherwise a crash timestamp is recorded; once
  `crashes.length > MAX_RESTARTS` (3) within `RESTART_WINDOW_MS` (2 minutes),
  `onFatal` fires (or `failStart` rejects before the first successful start).
  Otherwise it logs and `setTimeout(launch, 500)`. The recoverable classifier
  is in `electron/server.cjs` (`classifyTail`); the canonical pure version
  with tests is `lib/dev-server.ts`.
- The log is appended to `~/Library/Logs/Weft/server.log` (via
  `app.getPath("logs")`); files over `MAX_LOG_BYTES` (5 MB) are rotated to
  `server.log.old`. Returns `{ url, logPath, stop, restart }`.

## `electron/browser-pane.cjs`

A native `WebContentsView` overlaid on the board. Lazily created on first
`setVisible(true)` so the board's placeholder is shown until then.

- `state()` returns `{ visible, url, title, loading, canGoBack, canGoForward }`.
- `setBounds(rect)` clamps to non-negative integers; `layout()` only shows the
  view once a page has loaded.
- `setWindowOpenHandler` denies pop-ups and reopens them inside the same view. Links the
  board and the copilot window try to open in new windows are sent to this pane too.
- A focused page swallows keys the board never sees, so `before-input-event` replays a plain Escape
  into the board (which closes its newest layer via `useEscape`). Fullscreen pages keep it.
- A page load takes keyboard focus, so `open()` gives it back to the board when the board had it, and
  `layout()` hands focus to the board when it hides a view that holds it. Otherwise no key (Escape
  included) reaches the board. `useEscape(..., { panel: true })` marks board panels (thread, browser,
  library), which close only after every dialog and menu.
- `normalizeUrl(raw)` accepts `https?/file/about:` schemes, prepends `http://` to
  bare `localhost`/`127.0.0.1`/`[::1]`, rejects other schemes, and prepends
  `https://` to bare hostnames.
- Agent-facing API is the control server (`startControlServer`): a plain
  `http.createServer` on `127.0.0.1` with routes
  `POST /browser/open`, `GET /browser/text`, `GET /browser/screenshot`,
  `POST /browser/click`, `POST /browser/type`. Every request is checked for
  `Authorization: Bearer <token>` (the same `TOKEN` from `main.cjs`); the URL +
  token are passed to the Next server as `THREADBOARD_SHELL_URL` /
  `THREADBOARD_SHELL_TOKEN`, where `lib/browser-tools.ts` reads them and wraps
  them as `mcp__browser__*` MCP tools (`open_url`, `read_page`, `screenshot`,
  `click`, `type_text`). The board itself drives the pane over IPC
  (`electron/preload.cjs`).
- `POST /browser/url` returns the URL a card's page shows ("" with no page).
  `lib/glance.ts` uses it, with `paneUrl()` / `openInPane()` in
  `lib/browser-tools.ts`, to keep the pane from being empty or stale: a working
  page when a card's turn starts with no page (a dimmed scene picked per card id by
  `backdropFor()` from `electron/assets/backdrop-*.jpg` plus the splash's own, with the
  card's ask), and a Haiku-written update page after a turn that opened nothing (never
  over a live `http` page).
- `electron/pane-pages.cjs` (`createPanePages(dataDir)`, held as `pages` in `browser-pane.cjs`) remembers
  each card's page in `~/.weft/pages/index.json`: every `did-navigate` calls `record()`, which stores
  `{ cardId, url, kind: file|app|web, title, updatedAt, savedUrl? }`. A `file:` page in a temp folder
  (macOS clears those) is copied to `pages/<card>/` and kept as `savedUrl` (20 MB cap). The index
  shape mirrors a future `card_pages` table for cloud sync.
- `setActive(key)` calls `restore(key)` when the card opens with a blank browser (after a restart):
  `restoreUrl()` gives the saved copy or the url, or (never recorded) the last
  `mcp__browser__open_url` in `threads/<card>.json`; if that fails to load, `fallbackUrl()` gives
  `~/.weft/glance/<card>.html`. Nothing is restored at startup.

## `electron/preload.cjs`

The single `contextBridge.exposeInMainWorld("threadboard", …)` call. The UI's only
door into the shell: `browser.*` (open / state / setVisible / setBounds / back /
forward / reload / onState), `dialog.openFolder`, `openExternal`, `revealFolder`, `popupMenu`, `setBadge`,
`copilot.toggle` and `copilot.onState`, `onMenu`, and `splashAction` (only used by
the splash screen's retry/logs/quit buttons). Typed in `lib/client.ts` as
`ShellBridge`; when `window.threadboard` is absent the board is running in a normal
browser tab (`npm run dev`).

## `electron/env.cjs`

`fixPath()` replaces `process.env.PATH` with the user's login-shell `PATH` (default
shell `$SHELL` or `/bin/zsh`, with `-ilc` to source rc files), then merges in the
existing `PATH`. Apps opened from Finder or Dock inherit a bare PATH
(`/usr/bin:/bin:…`) that doesn't contain `claude`, `puku-cli`, or nvm's `node`.

## `electron/window-state.cjs`

`loadWindowState(name, defaults)` reads `userData/<name>-window.json` (e.g.
`main-window.json`, `copilot-window.json`) and verifies the saved bounds are still
on a connected display (`onScreen` — at least 120×80px of overlap with a display's
`workArea`); otherwise returns the defaults. `trackWindowState(name, win)` saves
`{ x, y, width, height, maximized }` on resize/move (debounced 400ms) and close,
skipping the call when the window is destroyed/minimized/fullscreen.

## `electron/splash.html`

A static `file://` page that `appView` loads while the server starts. `setStatus()`
and `showError()` are called via `webContents.executeJavaScript()`. On a fatal
startup error, the splash shows an error line and three buttons wired to
`splashAction`: `retry` (re-runs `boot()` or calls `server.restart()`), `logs`
(`shell.openPath(app.getPath("logs"))`), `quit`.

`electron/startup-screen.cjs` (`createStartupScreen`) drives it: `show(status)` and `fail(message)` load the
splash if it isn't up and call `setStatus`/`showError` (`fail` also brings the window forward and names the server log);
`loadBoard(url)` loads the board and swallows a rejected load. `watch(webContents)` turns two failures that used to
leave a stuck splash or a blank window into `fail()`: the board's main frame failing to load (except ERR_ABORTED, a load
replaced by another one such as Fast Refresh's reload) and its renderer dying (any reason but a clean exit).
Tested against a fake window in `electron/startup-screen.test.ts`.

## About window (`about.cjs`, `about.html`, `about.js`, `about-preload.cjs`)

Weft ▸ About Weft (the app menu on macOS, the bottom of Help elsewhere) opens the shell's own
window instead of the native panel, which can only show text. `showAboutWindow()` keeps one
instance and focuses it if it is already open. The page is a bundled `file://` file with a
`script-src 'self'` CSP, so it opens even when the server is down. It is a sandboxed,
fixed-size window on its own `about` session, and navigation and `window.open` are denied.
`about.js` renders everything with `textContent`.

`registerAboutBridge({ tagline, dataDir, getServer })` (called from `app.whenReady`) answers three
`weft-about:*` ipc channels, each checking that the caller is the About window:
- `info`: version, arch, packaged or not, Electron/Chromium/Node versions, data folder, the app's
  PID, and the server's port and PID from `server.port` / `server.pid`.
- `open`: `"data"` or `"logs"` only; the page never passes a path.
- `copy`: writes the page's plain-text twin to the clipboard (capped at 20k characters).

`server.cjs` exposes `port` and a `pid` getter (the current supervised process; it changes on
restart). In dev that PID is `next dev`'s launcher, not necessarily the process holding the port.

## Packaging

`package.json`'s `build` block drives `electron-builder`:

- `appId: app.weft.desktop`, `productName: Weft`, `output: dist`,
  `buildResources: build`.
- `files: ["electron/**/*", "package.json", "!node_modules${/*}"]` — the Electron
  app bundles only the shell + `package.json`. The Next server is shipped under
  `extraResources`.
- `extraResources` copies `.next-dist/standalone` to `server/` and, separately,
  `.next-dist/standalone/node_modules` to `server/node_modules`, because electron-builder
  drops the top-level `node_modules` of a copied folder.
- `protocols: [{ name: "Weft", schemes: ["weft"] }]` registers the deep-link
  scheme. `mac.target: dir`, `arch: arm64`, `category:
  public.app-category.developer-tools`, `identity: null`, `hardenedRuntime: false`,
  `NSAppleEventsUsageDescription: "Weft opens Terminal to run a command-line
  tool's login when it needs a real terminal."` (used by the AppleScript in
  `lib/login.ts`).

`npm run dist` runs `THREADBOARD_DIST=.next-dist THREADBOARD_STANDALONE=1 next
build && node scripts/prepare-standalone.mjs .next-dist && electron-builder --mac
--dir`. The build flow:

1. `next build` with `output: "standalone"` (`next.config.ts` sets it when
   `THREADBOARD_STANDALONE=1`) produces `.next-dist/standalone/`. Tracing pulls in the whole
   project, because `lib/login.ts` spawns CLIs by a computed path, which Next can't trace
   narrowly; the prepare script prunes the extras.
2. `scripts/prepare-standalone.mjs`:
   - Prunes `standalone/` to the set `{ server.js, package.json, node_modules,
     public, <distDir> }`.
   - Copies `<distDir>/static` into `standalone/<distDir>/static` and
     `public/` into `standalone/public`.
   - Ensures `@anthropic-ai/claude-agent-sdk` and the platform package
     (`@anthropic-ai/claude-agent-sdk-<platform>-<arch>`) are present in
     `standalone/node_modules` (tracing can miss them), `chmod 0o755` the
     `claude` native binary, and `claude --version`s it to confirm.
   - Walks the standalone folder, replacing any symlink that points outside
     it with a copy of its target (the app is copied around at install time,
     so dangling or external symlinks break).
3. `electron-builder --mac --dir` lays out `Weft.app/Contents/Resources/server/`
   and `Weft.app/Contents/Frameworks/Weft Helper.app/...` from the prepared
   standalone and the shell.

The server in packaged builds is launched as `Weft Helper` (Electron's helper binary, with
`ELECTRON_RUN_AS_NODE=1`) instead of the main `Weft` executable. Started from the main
executable, macOS saw a second app named Weft, and quitting by name (`osascript -e 'quit app
"Weft"'`) went to the wrong one; as a helper it doesn't register as an app.

## Right-click menus

The board's card and column menus are native, so the narrow board never clips them.
`lib/card-menu.ts` builds them as plain data (`cardMenu`, `columnMenu`; flat, no submenus, tested in
`lib/card-menu.test.ts`); `components/use-board-menus.ts` passes them to `threadboard.popupMenu` and runs
the picked id through the board's own move, archive, open and API calls. In a plain browser tab there is
no shell, so the browser's own menu shows.
