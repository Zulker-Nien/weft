// The side browser pane: a native view laid over the board where the board's placeholder sits.
// The board drives it over IPC; agents drive it through a token-protected control server on
// 127.0.0.1 (see lib/browser-tools.ts).
const { WebContentsView } = require("electron");
const http = require("node:http");

function createBrowserPane({ getWindow, getAppView, token, onContents }) {
  // One page per card (keyed by card id), so each review keeps its own browser; "board" is the
  // one shown with no card open. Only the active one is on screen.
  const BOARD = "board";
  const views = new Map();
  let active = BOARD;
  let visible = false;
  let bounds = { x: 0, y: 0, width: 0, height: 0 };

  function state() {
    const wc = views.get(active)?.webContents;
    return {
      visible,
      url: wc ? wc.getURL() : "",
      title: wc ? wc.getTitle() : "",
      loading: wc ? wc.isLoading() : false,
      canGoBack: wc ? wc.navigationHistory.canGoBack() : false,
      canGoForward: wc ? wc.navigationHistory.canGoForward() : false,
    };
  }

  function sendState() {
    const appView = getAppView();
    if (appView && !appView.webContents.isDestroyed()) appView.webContents.send("browser:state", state());
  }

  function layout() {
    for (const [key, view] of views) {
      view.setBounds(bounds);
      // Until a page loads, the board shows its own placeholder instead of a blank view.
      const hasPage = Boolean(view.webContents.getURL());
      const onScreen = key === active && visible && hasPage && bounds.width > 0 && bounds.height > 0;
      view.setVisible(onScreen);
      // Only the page on screen plays sound; background cards' pages keep running but stay silent.
      view.webContents.setAudioMuted(!onScreen);
    }
  }

  function ensure(key = active) {
    const existing = views.get(key);
    if (existing) return existing;
    const view = new WebContentsView({
      webPreferences: { partition: "persist:threadboard-browser", sandbox: true, contextIsolation: true },
    });
    view.setBackgroundColor("#ffffff");
    getWindow().contentView.addChildView(view);
    views.set(key, view);
    const wc = view.webContents;
    onContents?.(wc);
    // A focused page swallows keys the board never sees, so Escape is replayed into the board too,
    // where it closes the newest layer as usual. A fullscreen video keeps it to leave fullscreen.
    let fullscreen = false;
    wc.on("enter-html-full-screen", () => (fullscreen = true));
    wc.on("leave-html-full-screen", () => (fullscreen = false));
    wc.on("before-input-event", (_e, input) => {
      if (input.type !== "keyDown" || input.key !== "Escape" || fullscreen) return;
      if (input.shift || input.control || input.alt || input.meta) return;
      const board = getAppView()?.webContents;
      if (!board || board.isDestroyed()) return;
      board.focus();
      board.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
      board.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
    });
    // Pop-ups open in the same card's view instead of new windows.
    wc.setWindowOpenHandler(({ url }) => {
      wc.loadURL(url).catch(() => {});
      return { action: "deny" };
    });
    for (const event of ["did-navigate", "did-navigate-in-page", "page-title-updated", "did-start-loading", "did-stop-loading"]) {
      wc.on(event, () => {
        layout();
        if (key === active) sendState();
      });
    }
    layout();
    return view;
  }

  function setVisible(next) {
    visible = next;
    if (visible) ensure();
    layout();
    sendState();
  }

  // Shows a card's browser, or the board's own with no card open. A card and its browser go together:
  // opening a card shows its page (if it has one), and closing the card hides the pane.
  function setActive(key) {
    if (key === active) return;
    active = key || BOARD;
    visible = active !== BOARD && Boolean(views.get(active)?.webContents.getURL());
    layout();
    sendState();
  }

  // Closes the browsers of cards that are gone.
  function prune(keep) {
    const keepKeys = new Set([BOARD, active, ...keep]);
    for (const [key, view] of views) {
      if (keepKeys.has(key)) continue;
      views.delete(key);
      try {
        getWindow().contentView.removeChildView(view);
        view.webContents.close();
      } catch {}
    }
  }

  function setBounds(rect) {
    bounds = {
      x: Math.max(0, Math.round(rect.x)),
      y: Math.max(0, Math.round(rect.y)),
      width: Math.max(0, Math.round(rect.width)),
      height: Math.max(0, Math.round(rect.height)),
    };
    layout();
  }

  function normalizeUrl(raw) {
    const url = String(raw || "").trim();
    if (/^(https?|file|about):/i.test(url)) return url;
    if (/^(localhost|127\.0\.0\.1|\[::1\])([:/]|$)/i.test(url)) return `http://${url}`;
    if (/^[a-z][a-z0-9+.-]*:/i.test(url)) throw new Error(`Can't open ${url} in the browser pane`);
    return `https://${url}`;
  }

  // Weft's own server, with localhost and 127.0.0.1 treated as one host.
  function isSelf(url) {
    const key = (u) => {
      const { protocol, hostname, port } = new URL(u);
      return `${protocol}//${hostname === "localhost" ? "127.0.0.1" : hostname}:${port}`;
    };
    try {
      const own = getAppView()?.webContents.getURL();
      return Boolean(own) && key(own) === key(url);
    } catch {
      return false;
    }
  }

  // Loads a page in a card's browser. Opening in the card on screen shows the pane; another card's
  // browser (an agent working in the background) loads without taking over the screen.
  // From the board itself (activate), the card's browser is brought on screen.
  async function open(raw, key = active, activate = false) {
    const url = normalizeUrl(raw);
    // Weft inside its own pane is a confusing hall of mirrors; a card working on Weft should run
    // its own dev server on another port.
    if (isSelf(url)) throw new Error(`${url} is Weft itself; open the card's own dev server instead`);
    if (activate) active = key;
    const v = ensure(key);
    if (key === active) setVisible(true);
    try {
      await v.webContents.loadURL(url);
    } catch (err) {
      // Redirects reject the first load with ERR_ABORTED; the page still loads.
      if (err.code !== "ERR_ABORTED") throw err;
    }
    return { url: v.webContents.getURL(), title: v.webContents.getTitle() };
  }

  function requirePage(key = active) {
    const view = views.get(key);
    if (!view || !view.webContents.getURL()) throw new Error("The browser pane has no page open yet. Use open_url first.");
    return view.webContents;
  }

  async function pageText(key) {
    const wc = requirePage(key);
    const text = await wc.executeJavaScript("document.body ? document.body.innerText : ''");
    return { url: wc.getURL(), title: wc.getTitle(), text: String(text).slice(0, 30_000) };
  }

  async function screenshot(key = active) {
    const wc = requirePage(key);
    if (key === active && !visible) setVisible(true);
    let image = await wc.capturePage();
    if (image.getSize().width > 1280) image = image.resize({ width: 1280 });
    return { png: image.toPNG().toString("base64") };
  }

  async function click(selector, key) {
    const wc = requirePage(key);
    const found = await wc.executeJavaScript(`(() => {
      const el = document.querySelector(${JSON.stringify(String(selector))});
      if (!el) return false;
      el.scrollIntoView({ block: "center" });
      el.click();
      return true;
    })()`);
    return { found };
  }

  async function typeText(selector, text, key) {
    const wc = requirePage(key);
    const found = await wc.executeJavaScript(`(() => {
      const el = document.querySelector(${JSON.stringify(String(selector))});
      if (!el) return false;
      el.focus();
      if (typeof el.select === "function") el.select();
      else document.execCommand("selectAll");
      return true;
    })()`);
    if (found) await wc.insertText(String(text));
    return { found };
  }

  function readJson(req) {
    return new Promise((resolve, reject) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch (err) {
          reject(err);
        }
      });
    });
  }

  // Resolves to the control server's base URL.
  function startControlServer() {
    const routes = {
      "POST /browser/open": (body) => open(body.url, body.key),
      "POST /browser/text": (body) => pageText(body.key),
      // What a card's browser shows, "" when it has no page yet (see lib/glance.ts).
      "POST /browser/url": (body) => ({ url: views.get(body.key)?.webContents.getURL() || "" }),
      "POST /browser/screenshot": (body) => screenshot(body.key),
      "POST /browser/click": (body) => click(body.selector, body.key),
      "POST /browser/type": (body) => typeText(body.selector, body.text, body.key),
    };
    const server = http.createServer(async (req, res) => {
      const send = (status, body) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      if (req.headers.authorization !== `Bearer ${token}`) return send(401, { error: "Unauthorized" });
      const handler = routes[`${req.method} ${req.url}`];
      if (!handler) return send(404, { error: "Not found" });
      try {
        send(200, await handler(req.method === "POST" ? await readJson(req) : {}));
      } catch (err) {
        send(500, { error: err?.message || String(err) });
      }
    });
    return new Promise((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`));
    });
  }

  return {
    state,
    open,
    setVisible,
    setBounds,
    isVisible: () => visible,
    setActive,
    prune,
    webContents: () => views.get(active)?.webContents,
    back: () => views.get(active)?.webContents.navigationHistory.goBack(),
    forward: () => views.get(active)?.webContents.navigationHistory.goForward(),
    reload: () => views.get(active)?.webContents.reload(),
    startControlServer,
  };
}

module.exports = { createBrowserPane };
