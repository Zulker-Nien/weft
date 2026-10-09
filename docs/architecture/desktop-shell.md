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
- `PREFERRED_PORT` is `THREADBOARD_PORT` or `3457`; `server.cjs` uses a free port instead
  when that one is taken. (`npm run dev`, the board-only mode without Electron, uses
  `3456`.)
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
- `COPILOT_SHORTCUT = "Control+Alt+Space"` is registered with `globalShortcut` at
  startup. If the OS refuses it, a warning is logged.
- The application menu, the context menu (`attachContextMenu`), the tray
  (`createTray` + `updateTray`), the dock menu and badge (`setupDock`,
  `refreshWaiting`), and the splash → main view transition (`boot`, `showSplash`,
  `showFailure`) are all in this file.
- `weft://` links (`handleLink`):
  - `weft://copilot` → `showCopilot()`
  - `weft://card/<id>` → `sendMenu("open-card", id)`
  - `weft://new?prompt=…&folder=…&title=…&cli=puku&start=1` → POSTs
    `/api/cards` (with `x-threadboard: 1`) and then opens the new card. If
    `folder` is missing, the most recent project's path is read from
    `/api/settings` (falling back to `os.homedir()`).
- IPC handlers at the bottom: `browser:open`, `browser:state`, `browser:visible`,
  `browser:bounds`, `browser:back/forward/reload`, `copilot:toggle`,
  `dialog:openFolder`, `shell:openExternal` (http/https only), `badge:set`, and
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
- On exit, if the process wasn't stopped on purpose and wasn't replaced, a
  crash timestamp is recorded; once `crashes.length > MAX_RESTARTS` (3) within
  `RESTART_WINDOW_MS` (2 minutes), `onFatal` fires (or `failStart` rejects before
  the first successful start). Otherwise it logs and `setTimeout(launch, 500)`.
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

## `electron/preload.cjs`

The single `contextBridge.exposeInMainWorld("threadboard", …)` call. The UI's only
door into the shell: `browser.*` (open / state / setVisible / setBounds / back /
forward / reload / onState), `dialog.openFolder`, `openExternal`, `setBadge`,
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
