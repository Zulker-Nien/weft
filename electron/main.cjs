// Weft's desktop shell: starts and supervises the Next.js server, shows the board in a native
// window with a side browser pane, keeps the copilot in its own window, and adds the macOS
// pieces: menus, a menu bar icon, a dock menu and badge, a global copilot shortcut, and weft:// links.
const {
  BaseWindow,
  BrowserWindow,
  Menu,
  WebContentsView,
  app,
  dialog,
  globalShortcut,
  ipcMain,
  nativeTheme,
  session,
  shell,
} = require("electron");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { registerAboutBridge } = require("./about.cjs");
const { createBrowserPane } = require("./browser-pane.cjs");
const { createBoardView, boardViewRoutes } = require("./board-view.cjs");
const { createMenus } = require("./menus.cjs");
const { createPageLinks } = require("./page-links.cjs");
const { createPanePages } = require("./pane-pages.cjs");
const { removeShellToken, writeShellToken } = require("./shell-token.cjs");
const { appendToolchain, fixPath } = require("./env.cjs");
const { startServer } = require("./server.cjs");
const { createStartupScreen } = require("./startup-screen.cjs");
const { createStartupTimer } = require("./startup-timer.cjs");
const { registerTerminal } = require("./terminal.cjs");
const { themeSource } = require("./theme-source.cjs");
const { loadWindowState, trackWindowState } = require("./window-state.cjs");
const { createAccountLink } = require("./account-link.cjs");
const { argvLink } = require("./argv-link.cjs");
const { createMenuPopup } = require("./main-menu-popup.cjs");

const APP_NAME = "Weft";
const TAGLINE = "A board for your AI";
const ASSETS = path.join(__dirname, "assets");
const PRELOAD = path.join(__dirname, "preload.cjs");
const TOKEN = crypto.randomBytes(24).toString("hex");
const PREFERRED_PORT = Number(process.env.THREADBOARD_PORT) || 1024;
const COPILOT_SHORTCUT = "Control+Alt+Space";
const PROTOCOL = "weft";
const mac = process.platform === "darwin";

app.setName(APP_NAME);
// The board plays a chime when a card changes column, often before you've clicked anything.
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

let win;
let appView;
let copilotWin;
let server;
let quitting = false;
// weft:// links that arrive before the board is ready.
const pendingLinks = [];
const timer = createStartupTimer({
  version: app.getVersion(),
  mode: app.isPackaged ? "packaged" : process.env.THREADBOARD_PROD ? "prod" : "dev",
});

// The secrets vault, set up further down; the pane types its values in for threads (fillSecret).
// With it, commands and dev servers run with vault values (secret-run.cjs) and the push to Vercel (vercel-env.cjs).
let vault, secretRun, vercelEnv;
// Small native warning dialog; shared by pageLinks (walk-through buttons) and accountLink (OAuth callback).
const warnUser = (message, detail) => dialog.showMessageBox(win, { type: "warning", message, detail });
const pane = createBrowserPane({
  secrets: () => vault, secretRun: () => secretRun,
  getWindow: () => win, getAppView: () => appView,
  token: TOKEN,
  onContents: (contents) => menus.attachContextMenu(contents),
  pages: createPanePages(dataDir()),
  // weft:// links clicked inside a pane page, like a walk-through's buttons.
  onLink: (url, from) => pageLinks.handle(url, from) || handleLink(url),
  routes: {
    // The Weft account's session, sealed by safeStorage; the server reads it here instead of a plain file.
    ...require("./account-store.cjs").accountRoutesFor(dataDir()),
    // mcp__secrets__add_blank: names into the card's vault with no value yet, for the user to fill in later
    // (lib/secret-ask.ts). The rail's 🔐 count goes up; nothing opens.
    "POST /secrets/add-blank": ({ folder, names, environment, hint }) => {
      if (!vault) throw new Error("The secrets vault isn't ready yet.");
      const list = Array.isArray(names) ? names.map(String) : [];
      return vault.addBlanks(String(folder), list, [String(environment || "development")], { source: "a thread", hint: hint ? String(hint).slice(0, 200) : undefined });
    },
    // mcp__secrets__ask_add, and a fill or run that found a key missing: the name goes in as a blank, then the
    // 🔐 drawer opens on its Add form with the name filled in (lib/secret-ask.ts); the board checks the ask
    // (lib/vault-view.ts parseSecretAsk).
    "POST /secrets/ask-add": async ({ folder, name, environment }) => {
      await vault?.addBlanks(String(folder), [String(name)], [String(environment || "development")], { source: "a thread" }).catch(() => null);
      sendMenu("add-secret", JSON.stringify({ folder, name, environment }));
      return { opened: true };
    },
    // mcp__secrets__push_to_vercel: a vault value onto the card's linked Vercel project, after Touch ID.
    ...require("./vercel-env.cjs").envRoutes(() => vercelEnv),
    // mcp__board_view__*: threads see and drive the board itself, secrets redacted (electron/board-view.cjs).
    ...boardViewRoutes(createBoardView({ board: () => appView?.webContents })),
  },
});
// A walk-through page's buttons: replies, and commits that run with no turn.
const pageLinks = createPageLinks({
  getServer: () => server,
  contentsFor: (key) => pane.contentsFor(key),
  warn: warnUser,
});

// weft://account-callback links: forward to the board's /api/account/weft-callback so the OAuth
// code can be exchanged against the PKCE verifier.
const accountLink = createAccountLink({ getServer: () => server, showMain, warn: warnUser });

// Only one Weft runs at a time; opening it again brings the existing window forward.
const primary = app.requestSingleInstanceLock();
if (!primary) app.quit();

app.on("second-instance", (_event, argv) => {
  showMain();
  // weft:// links may arrive as a raw arg (the wrapper passes them through) or as `--weft-link=…`
  // when the wrapper wants to be explicit. macOS's open-url event covers the running case; this
  // handler covers the second-instance path on every platform.
  const link = argvLink(argv, PROTOCOL);
  if (link) handleLink(link);
});

// macOS delivers weft:// links here, possibly before the app is ready.
app.on("open-url", (event, url) => {
  event.preventDefault();
  handleLink(url);
});

function background() {
  return nativeTheme.shouldUseDarkColors ? "#131312" : "#f4f3ef";
}

// The board keeps the user's Appearance choice in a cookie (lib/theme.ts). Following it here gives
// the window background, menus, and the startup screen the same theme as the board.
const THEME_COOKIE = "weft-theme";

function setThemeSource(value) {
  nativeTheme.themeSource = themeSource(value);
}

async function followThemeChoice() {
  const { cookies } = session.defaultSession;
  const [saved] = await cookies.get({ name: THEME_COOKIE }).catch(() => []);
  setThemeSource(saved?.value);
  cookies.on("changed", (_event, cookie, cause, removed) => {
    // Rewriting the cookie first reports the old value as removed; wait for the new one.
    if (cookie.name !== THEME_COOKIE || (removed && cause === "overwrite")) return;
    setThemeSource(removed ? undefined : cookie.value);
  });
}

function dataDir() {
  return process.env.THREADBOARD_DATA || path.join(os.homedir(), ".weft");
}

function sendMenu(action, payload) {
  if (appView && !appView.webContents.isDestroyed()) appView.webContents.send("menu", action, payload);
}

function showMain() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  if (mac) app.focus({ steal: true });
}

// ---- Startup screen ----

const startup = createStartupScreen({ view: () => appView, version: app.getVersion(), showMain, logPath: () => server?.logPath });
let controlUrl;

async function boot() {
  await startup.show("Finding your command-line tools…");
  await fixPath();
  if (app.isPackaged) appendToolchain(path.join(process.resourcesPath, "toolchain", "bin"));
  timer.mark("path");
  await startup.show("Starting the board…");
  controlUrl ??= await pane.startControlServer();
  writeShellToken(dataDir(), TOKEN);
  try {
    server = await startServer({
      preferredPort: PREFERRED_PORT,
      // The token goes in a file, not the env, where any process of yours could read it (electron/shell-token.cjs).
      env: { THREADBOARD_SHELL_URL: controlUrl, THREADBOARD_APP_PID: String(process.pid) },
      onFatal: (message) => startup.fail(message),
      onMark: timer.mark,
    });
  } catch (err) {
    await startup.fail(err.message);
    return;
  }
  timer.mark("server");
  await startup.loadBoard(server.url);
  timer.mark("page");
  for (const link of pendingLinks.splice(0)) handleLink(link);
}

// ---- Windows ----

function createMainWindow() {
  const state = loadWindowState("main", { width: 1480, height: 920 });
  win = new BaseWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: 900,
    minHeight: 600,
    title: APP_NAME,
    show: false,
    backgroundColor: background(),
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 15 },
  });
  if (state.maximized) win.maximize();
  trackWindowState("main", win);

  appView = new WebContentsView({ webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true } });
  appView.setBackgroundColor(background());
  win.contentView.addChildView(appView);
  const fit = () => {
    const { width, height } = win.getContentBounds();
    appView.setBounds({ x: 0, y: 0, width, height });
  };
  win.on("resize", fit);
  fit();

  // On macOS, closing the window keeps Weft (and your threads) running; ⌘Q quits.
  win.on("close", (event) => {
    if (!quitting && mac) {
      event.preventDefault();
      win.hide();
    }
  });
  win.on("closed", () => {
    win = undefined;
    if (!mac) app.quit();
  });

  // Links in the board open in the browser pane, not a new window.
  appView.webContents.setWindowOpenHandler(({ url }) => {
    pane.open(url).catch(() => {});
    return { action: "deny" };
  });
  menus.attachContextMenu(appView.webContents);
  appView.webContents.once("did-finish-load", () => win?.show());
  startup.watch(appView.webContents);
}

function sendCopilotState() {
  const open = Boolean(copilotWin && !copilotWin.isDestroyed() && copilotWin.isVisible());
  if (appView && !appView.webContents.isDestroyed()) appView.webContents.send("copilot:state", { open });
}

function createCopilot() {
  const main = win?.getBounds() ?? { x: 80, y: 80, width: 1400, height: 900 };
  const state = loadWindowState("copilot", {
    width: 420,
    height: 680,
    x: Math.max(0, main.x + main.width - 444),
    y: Math.max(0, main.y + main.height - 704),
  });
  copilotWin = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: 340,
    minHeight: 420,
    title: "Copilot",
    show: false,
    backgroundColor: background(),
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 14, y: 15 },
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true },
  });
  trackWindowState("copilot", copilotWin);
  copilotWin.webContents.setWindowOpenHandler(({ url }) => {
    pane.open(url).catch(() => {});
    return { action: "deny" };
  });
  menus.attachContextMenu(copilotWin.webContents);
  // Closing hides it, so it reopens instantly with the conversation in place.
  copilotWin.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      copilotWin.hide();
    }
  });
  copilotWin.on("show", sendCopilotState);
  copilotWin.on("hide", sendCopilotState);
  copilotWin.on("closed", () => {
    copilotWin = undefined;
    sendCopilotState();
  });
  copilotWin.loadURL(`${server.url}/copilot`);
}

function showCopilot() {
  if (!server) return;
  if (!copilotWin || copilotWin.isDestroyed()) createCopilot();
  copilotWin.show();
  copilotWin.focus();
  if (mac) app.focus({ steal: true });
  sendCopilotState();
}

function toggleCopilot() {
  if (copilotWin && !copilotWin.isDestroyed() && copilotWin.isVisible() && copilotWin.isFocused()) {
    copilotWin.hide();
    sendCopilotState();
  } else {
    showCopilot();
  }
}

// ---- weft:// links ----
// weft://new?prompt=…&folder=…&title=…&cli=puku&start=1   create a card (in the most recent project by default)
// weft://card/<id>                                        open a card
// weft://copilot                                          open the copilot
// weft://reply and weft://commit come from a card's own page in the pane (page-links.cjs)

async function handleLink(raw) {
  if (accountLink.isAccountCallback(raw)) return accountLink.handle(raw);
  if (!server) {
    pendingLinks.push(raw);
    return;
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    return;
  }
  const action = url.hostname;
  if (action === "copilot") return showCopilot();
  showMain();
  if (action === "card") return sendMenu("open-card", url.pathname.replace(/^\/+/, ""));
  if (action !== "new") return;
  return handleNewThreadLink(url);
}

async function handleNewThreadLink(url) {
  const prompt = url.searchParams.get("prompt");
  if (!prompt) return sendMenu("new-thread");
  try {
    let folder = url.searchParams.get("folder");
    if (!folder) {
      const settings = await (await fetch(`${server.url}/api/settings`)).json();
      folder = settings.projects?.[0]?.path ?? os.homedir();
    }
    const res = await fetch(`${server.url}/api/cards`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-threadboard": "1" },
      body: JSON.stringify({
        prompt,
        title: url.searchParams.get("title") ?? undefined,
        cwd: folder,
        backend: url.searchParams.get("cli") === "puku" ? "puku" : "claude",
        start: url.searchParams.get("start") === "1",
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? res.statusText);
    sendMenu("open-card", data.card.id);
  } catch (err) {
    dialog.showMessageBox(win, { type: "warning", message: "Couldn't create the card", detail: err.message });
  }
}

// ---- Menus, tray, dock (menus.cjs) ----

const menus = createMenus({
  APP_NAME,
  ASSETS,
  COPILOT_SHORTCUT,
  mac,
  pane,
  getWin: () => win,
  getAppView: () => appView,
  getServer: () => server,
  showMain,
  sendMenu,
  showCopilot,
  toggleCopilot,
  dataDir,
});

// ---- IPC from the board and copilot ----

// A page that won't load (a dev server that isn't running) is shown in the pane; it isn't an error for the board.
ipcMain.handle("browser:open", (_e, url, key) => pane.open(url, key || undefined, true).catch((err) => ({ error: String(err.message || err) })));
ipcMain.handle("browser:state", () => pane.state());
ipcMain.on("browser:visible", (_e, visible) => pane.setVisible(Boolean(visible)));
ipcMain.on("browser:active", (_e, key) => pane.setActive(key));
ipcMain.on("browser:prune", (_e, keys) => pane.prune(Array.isArray(keys) ? keys : []));
// The board measures in its own CSS pixels; once it's zoomed (View > Zoom In/Out) those no longer
// match window pixels, so scale by its zoom factor or the native view lands off its placeholder.
ipcMain.on("browser:bounds", (e, rect) => {
  const z = e.sender.getZoomFactor();
  pane.setBounds({ x: rect.x * z, y: rect.y * z, width: rect.width * z, height: rect.height * z });
});
ipcMain.on("browser:back", () => pane.back());
ipcMain.on("browser:forward", () => pane.forward());
ipcMain.on("browser:reload", () => pane.reload());
ipcMain.on("browser:zoom", (_e, action) => pane.zoom(action));
ipcMain.on("copilot:toggle", () => toggleCopilot());
const killTerminals = registerTerminal(ipcMain);
ipcMain.handle("dialog:openFolder", async () => {
  const result = await dialog.showOpenDialog(win, { properties: ["openDirectory", "createDirectory"] });
  return result.canceled ? null : result.filePaths[0];
});
ipcMain.on("shell:openExternal", (_e, url) => /^https?:\/\//i.test(String(url)) && shell.openExternal(String(url)));
createMenuPopup({ ipcMain, Menu, BrowserWindow });
ipcMain.on("shell:reveal", (_e, folder) => path.isAbsolute(String(folder)) && fs.existsSync(String(folder)) && shell.openPath(String(folder)));
// The secrets vault answers the board window only; threads reach values only through the pane typing them in, behind Touch ID.
vault = require("./vault.cjs").setupVault({ ipcMain, dataDir: dataDir(), window: () => win, board: () => appView?.webContents });
secretRun = require("./secret-run.cjs").setupSecretRun({ vault, dataDir: dataDir(), window: () => win });
// So does Vercel: its token is in the Keychain and its links are .vercel/project.json.
vercelEnv = require("./vercel.cjs").setupVercel({ ipcMain, dataDir: dataDir(), board: () => appView?.webContents, vault }).env;
// And Supabase: its token is in the Keychain and its links are supabase/.temp/project-ref.
require("./supabase.cjs").setupSupabase({ ipcMain, dataDir: dataDir(), board: () => appView?.webContents, vault });
// And BlastCP: its sign-in is in the Keychain too, and which property a folder posts as is in the data folder.
require("./blastcp.cjs").setupBlastcp({ ipcMain, dataDir: dataDir(), board: () => appView?.webContents });
// And Cloudflare: its token is in the Keychain and which Worker or Pages project a folder is is in the data folder.
require("./cloudflare.cjs").setupCloudflare({ ipcMain, dataDir: dataDir(), board: () => appView?.webContents });
// The board's first cards are on screen: save this launch's timing and tell the board if it ran slow.
ipcMain.handle("startup:ready", () => timer.finish());
ipcMain.on("badge:set",(_e, count) => menus.refreshWaiting(Number(count) || 0));
ipcMain.on("splash:action", async (_e, action) => {
  // "relaunch": a drawer whose main side arrived after launch (BlastCP) starts Weft again on the new code.
  if (action === "relaunch") app.relaunch();
  if (action === "quit" || action === "relaunch") return app.quit();
  if (action === "logs") return shell.openPath(app.getPath("logs"));
  if (action !== "retry") return;
  if (!server) return boot();
  await startup.show("Restarting…");
  try {
    await server.restart();
    await startup.loadBoard(server.url);
  } catch (err) {
    startup.fail(err.message);
  }
});

// ---- Lifecycle ----

app.whenReady().then(async () => {
  if (!primary) return;
  timer.mark("ready");
  await followThemeChoice();
  registerAboutBridge({ tagline: TAGLINE, dataDir, getServer: () => server });
  if (app.isPackaged) app.setAsDefaultProtocolClient(PROTOCOL);
  menus.buildMenu();
  menus.setupDock();
  createMainWindow();
  menus.createTray();
  menus.updater.start();
  if (!globalShortcut.register(COPILOT_SHORTCUT, toggleCopilot)) {
    console.warn(`Couldn't register ${COPILOT_SHORTCUT}; another app may be using it.`);
  }
  nativeTheme.on("updated", () => {
    const color = background();
    win?.setBackgroundColor(color);
    appView?.setBackgroundColor(color);
    if (copilotWin && !copilotWin.isDestroyed()) copilotWin.setBackgroundColor(color);
  });
  await boot();
});

// Clicking the dock icon (or a notification) brings the board back.
app.on("activate", showMain);

app.on("before-quit", () => {
  quitting = true;
});

app.on("will-quit", () => {
  menus.keepWorking?.stopSync();
  globalShortcut.unregisterAll();
  killTerminals();
  server?.stop();
  removeShellToken(dataDir());
});

app.on("window-all-closed", () => {
  if (!mac) app.quit();
});
