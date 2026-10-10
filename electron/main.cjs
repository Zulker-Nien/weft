// Weft's desktop shell: starts and supervises the Next.js server, shows the board in a native
// window with a side browser pane, keeps the copilot in its own window, and adds the macOS
// pieces: menus, a menu bar icon, a dock menu and badge, a global copilot shortcut, and weft:// links.
const {
  BaseWindow,
  BrowserWindow,
  Menu,
  Tray,
  WebContentsView,
  app,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  nativeImage,
  nativeTheme,
  session,
  shell,
  webContents,
} = require("electron");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { registerAboutBridge, showAboutWindow } = require("./about.cjs");
const { createBrowserPane } = require("./browser-pane.cjs");
const { fixPath } = require("./env.cjs");
const { startServer } = require("./server.cjs");
const { registerTerminal } = require("./terminal.cjs");
const { loadWindowState, trackWindowState } = require("./window-state.cjs");

const APP_NAME = "Weft";
const TAGLINE = "A board for your AI";
const ASSETS = path.join(__dirname, "assets");
const PRELOAD = path.join(__dirname, "preload.cjs");
const TOKEN = crypto.randomBytes(24).toString("hex");
const PREFERRED_PORT = Number(process.env.THREADBOARD_PORT) || 1000;
const COPILOT_SHORTCUT = "Control+Alt+Space";
const PROTOCOL = "weft";
const mac = process.platform === "darwin";

app.setName(APP_NAME);
// The board plays a chime when a card changes column, often before you've clicked anything.
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

let win;
let appView;
let copilotWin;
let tray;
let server;
let quitting = false;
// weft:// links that arrive before the board is ready.
const pendingLinks = [];

const pane = createBrowserPane({
  getWindow: () => win,
  getAppView: () => appView,
  token: TOKEN,
  onContents: (contents) => attachContextMenu(contents),
});

// Only one Weft runs at a time; opening it again brings the existing window forward.
const primary = app.requestSingleInstanceLock();
if (!primary) app.quit();

app.on("second-instance", (_event, argv) => {
  showMain();
  const link = argv.find((arg) => arg.startsWith(`${PROTOCOL}://`));
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
  nativeTheme.themeSource = value === "light" || value === "dark" ? value : "system";
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

function onSplash() {
  return appView && appView.webContents.getURL().startsWith("file:");
}

// The version rides in the query string: the splash is a bare file:// page with no bridge.
function loadSplash() {
  return appView.webContents.loadFile(path.join(__dirname, "splash.html"), { query: { v: app.getVersion() } });
}

async function showSplash(status) {
  if (!onSplash()) await loadSplash();
  await appView.webContents.executeJavaScript(`setStatus(${JSON.stringify(status)})`).catch(() => {});
}

async function showFailure(message) {
  showMain();
  const detail = server?.logPath ? ` Details are in ${server.logPath}.` : "";
  if (!onSplash()) await loadSplash();
  await appView.webContents.executeJavaScript(`showError(${JSON.stringify(message + detail)})`).catch(() => {});
}

let controlUrl;

async function boot() {
  await showSplash("Finding your command-line tools…");
  await fixPath();
  await showSplash("Starting the board…");
  controlUrl ??= await pane.startControlServer();
  try {
    server = await startServer({
      preferredPort: PREFERRED_PORT,
      env: { THREADBOARD_SHELL_URL: controlUrl, THREADBOARD_SHELL_TOKEN: TOKEN },
      onFatal: (message) => showFailure(message),
    });
  } catch (err) {
    await showFailure(err.message);
    return;
  }
  await appView.webContents.loadURL(server.url);
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
  attachContextMenu(appView.webContents);
  appView.webContents.once("did-finish-load", () => win?.show());
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
  attachContextMenu(copilotWin.webContents);
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

async function handleLink(raw) {
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

// ---- Menus, tray, dock ----

function focusedContents() {
  return webContents.getFocusedWebContents() ?? appView?.webContents;
}

function buildMenu() {
  // Not `role: "about"`: the native panel shows text and nothing else; ours is a window (about.cjs).
  const aboutItem = { label: `About ${APP_NAME}`, click: showAboutWindow };
  const template = [
    ...(mac
      ? [
          {
            label: APP_NAME,
            submenu: [
              aboutItem,
              { type: "separator" },
              {
                label: "Settings…",
                accelerator: "CmdOrCtrl+,",
                click: () => {
                  showMain();
                  sendMenu("settings");
                },
              },
              {
                label: "Open at Login",
                type: "checkbox",
                checked: app.getLoginItemSettings().openAtLogin,
                click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
              },
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ]
      : []),
    {
      label: "File",
      submenu: [
        {
          label: "New Thread",
          accelerator: "CmdOrCtrl+N",
          click: () => {
            showMain();
            sendMenu("new-thread");
          },
        },
        { type: "separator" },
        { label: "Close Window", accelerator: "CmdOrCtrl+W", click: () => BaseWindow.getFocusedWindow()?.close() },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
        { type: "separator" },
        {
          label: "Find Cards",
          accelerator: "CmdOrCtrl+F",
          click: () => {
            showMain();
            sendMenu("find");
          },
        },
      ],
    },
    {
      label: "View",
      submenu: [
        { label: "Copilot", accelerator: "CmdOrCtrl+J", click: toggleCopilot },
        { label: "Browser", accelerator: "CmdOrCtrl+Shift+B", click: () => pane.setVisible(!pane.isVisible()) },
        {
          label: "Terminal",
          // VS Code's toggle; Control on macOS too.
          accelerator: "Ctrl+`",
          click: () => {
            showMain();
            sendMenu("terminal");
          },
        },
        { type: "separator" },
        { label: "Reload", accelerator: "CmdOrCtrl+R", click: () => focusedContents()?.reload() },
        { label: "Developer Tools", accelerator: "Alt+CmdOrCtrl+I", click: () => focusedContents()?.toggleDevTools() },
        { type: "separator" },
        { label: "Actual Size", accelerator: "CmdOrCtrl+0", click: () => focusedContents()?.setZoomLevel(0) },
        {
          label: "Zoom In",
          accelerator: "CmdOrCtrl+Plus",
          click: () => {
            const c = focusedContents();
            c?.setZoomLevel(c.getZoomLevel() + 0.5);
          },
        },
        {
          label: "Zoom Out",
          accelerator: "CmdOrCtrl+-",
          click: () => {
            const c = focusedContents();
            c?.setZoomLevel(c.getZoomLevel() - 0.5);
          },
        },
        { type: "separator" },
        { label: "Enter Full Screen", accelerator: "Ctrl+Cmd+F", click: () => win?.setFullScreen(!win.isFullScreen()) },
      ],
    },
    {
      label: "Window",
      submenu: [
        { label: "Minimize", accelerator: "CmdOrCtrl+M", click: () => BaseWindow.getFocusedWindow()?.minimize() },
        { label: "Zoom", click: () => win?.maximize() },
        { type: "separator" },
        { label: "Board", accelerator: "CmdOrCtrl+1", click: showMain },
        { label: "Copilot", accelerator: "CmdOrCtrl+2", click: showCopilot },
      ],
    },
    {
      role: "help",
      submenu: [
        { label: "Open Logs Folder", click: () => shell.openPath(app.getPath("logs")) },
        { label: "Open Data Folder", click: () => shell.openPath(dataDir()) },
        ...(mac ? [] : [{ type: "separator" }, aboutItem]),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function attachContextMenu(contents) {
  contents.on("context-menu", (_event, params) => {
    const items = [];
    if (params.linkURL && /^https?:/i.test(params.linkURL)) {
      items.push(
        { label: "Open Link in Browser Pane", click: () => pane.open(params.linkURL).catch(() => {}) },
        { label: "Open Link in Default Browser", click: () => shell.openExternal(params.linkURL) },
        { label: "Copy Link", click: () => clipboard.writeText(params.linkURL) },
        { type: "separator" },
      );
    }
    if (params.isEditable) items.push({ role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" });
    else if (params.selectionText) items.push({ role: "copy" });
    if (!app.isPackaged) items.push({ type: "separator" }, { label: "Inspect Element", click: () => contents.inspectElement(params.x, params.y) });
    while (items.length && items[0].type === "separator") items.shift();
    while (items.length && items.at(-1).type === "separator") items.pop();
    if (items.length) Menu.buildFromTemplate(items).popup();
  });
}

function clip(text, max) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function createTray() {
  const icon = path.join(ASSETS, "trayTemplate.png");
  if (!fs.existsSync(icon)) return;
  tray = new Tray(nativeImage.createFromPath(icon));
  tray.setToolTip(APP_NAME);
  updateTray([]);
}

// The menu bar icon shows how many cards need you, and lists them.
function updateTray(waiting) {
  if (!tray) return;
  const count = waiting.length;
  tray.setTitle(count > 0 ? ` ${count}` : "");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: count > 0 ? `${count} ${count === 1 ? "card needs" : "cards need"} you` : "Nothing needs you", enabled: false },
      ...waiting.slice(0, 8).map((card) => ({
        label: clip(card.title, 48),
        click: () => {
          showMain();
          sendMenu("open-card", card.id);
        },
      })),
      { type: "separator" },
      { label: `Open ${APP_NAME}`, click: showMain },
      { label: "Copilot", accelerator: COPILOT_SHORTCUT, click: showCopilot },
      {
        label: "New Thread",
        click: () => {
          showMain();
          sendMenu("new-thread");
        },
      },
      { type: "separator" },
      { label: `Quit ${APP_NAME}`, click: () => app.quit() },
    ]),
  );
}

async function refreshWaiting(count) {
  if (mac) app.dock.setBadge(count > 0 ? String(count) : "");
  if (!server) return;
  try {
    const { cards } = await (await fetch(`${server.url}/api/cards`)).json();
    updateTray(cards.filter((card) => card.column === "needs_you"));
  } catch {}
}

function setupDock() {
  if (!mac) return;
  const icon = path.join(ASSETS, "icon.png");
  if (!app.isPackaged && fs.existsSync(icon)) app.dock.setIcon(icon);
  app.dock.setMenu(
    Menu.buildFromTemplate([
      {
        label: "New Thread",
        click: () => {
          showMain();
          sendMenu("new-thread");
        },
      },
      { label: "Copilot", click: showCopilot },
    ]),
  );
}

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
ipcMain.on("copilot:toggle", () => toggleCopilot());
const killTerminals = registerTerminal(ipcMain);
ipcMain.handle("dialog:openFolder", async () => {
  const result = await dialog.showOpenDialog(win, { properties: ["openDirectory", "createDirectory"] });
  return result.canceled ? null : result.filePaths[0];
});
ipcMain.on("shell:openExternal", (_e, url) => {
  if (/^https?:\/\//i.test(String(url))) shell.openExternal(String(url));
});
// The board's right-click menus (lib/card-menu.ts): shown natively so the narrow board never clips them.
// Resolves to the picked item's id, or null when dismissed.
ipcMain.handle("menu:popup", (e, items) =>
  new Promise((resolve) => {
    let picked = null;
    const template = (Array.isArray(items) ? items : []).map((item) =>
      item.type === "separator"
        ? { type: "separator" }
        : { label: String(item.label), enabled: item.enabled !== false, click: () => (picked = String(item.id)) },
    );
    // click fires before callback on macOS, but not on every platform; wait a tick for it.
    Menu.buildFromTemplate(template).popup({
      window: BrowserWindow.fromWebContents(e.sender) ?? undefined,
      callback: () => setTimeout(() => resolve(picked), 0),
    });
  }),
);
ipcMain.on("shell:reveal", (_e, folder) => {
  const dir = String(folder);
  if (path.isAbsolute(dir) && fs.existsSync(dir)) shell.openPath(dir);
});
ipcMain.on("badge:set", (_e, count) => refreshWaiting(Number(count) || 0));
ipcMain.on("splash:action", async (_e, action) => {
  if (action === "quit") return app.quit();
  if (action === "logs") return shell.openPath(app.getPath("logs"));
  if (action !== "retry") return;
  if (!server) return boot();
  await showSplash("Restarting…");
  try {
    await server.restart();
    await appView.webContents.loadURL(server.url);
  } catch (err) {
    showFailure(err.message);
  }
});

// ---- Lifecycle ----

app.whenReady().then(async () => {
  if (!primary) return;
  await followThemeChoice();
  registerAboutBridge({ tagline: TAGLINE, dataDir, getServer: () => server });
  if (app.isPackaged) app.setAsDefaultProtocolClient(PROTOCOL);
  buildMenu();
  setupDock();
  createMainWindow();
  createTray();
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
  globalShortcut.unregisterAll();
  killTerminals();
  server?.stop();
});

app.on("window-all-closed", () => {
  if (!mac) app.quit();
});
