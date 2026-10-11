// The side browser pane: a native view laid over the board where the board's placeholder sits.
// The board drives it over IPC; agents drive it through a token-protected control server on
// 127.0.0.1 (see lib/browser-tools.ts).
const { WebContentsView } = require("electron");
const http = require("node:http");
const { isSelfUrl } = require("./self-url.cjs");

// Chrome's zoom steps, as percentages; Zoom In/Out walk them.
const ZOOM_STEPS = [25, 33, 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400, 500];

// The next step up (dir 1) or down (dir -1) from a zoom that may sit between steps.
function stepZoom(percent, dir) {
  if (dir > 0) return ZOOM_STEPS.find((z) => z > percent + 0.5) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1];
  return [...ZOOM_STEPS].reverse().find((z) => z < percent - 0.5) ?? ZOOM_STEPS[0];
}

function createBrowserPane({ getWindow, getAppView, token, onContents, pages, onLink }) {
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
      zoom: wc ? Math.round(wc.getZoomFactor() * 100) : 100,
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
      // A hidden page keeps keyboard focus, and then no key reaches anything (Escape least of all).
      const losesFocus = !onScreen && view.webContents.isFocused();
      view.setVisible(onScreen);
      if (losesFocus) boardContents()?.focus();
      // Only the page on screen plays sound; background cards' pages keep running but stay silent.
      view.webContents.setAudioMuted(!onScreen);
    }
  }

  function boardContents() {
    const board = getAppView()?.webContents;
    return board && !board.isDestroyed() ? board : undefined;
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
      const board = boardContents();
      if (!board) return;
      board.focus();
      board.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
      board.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
    });
    // Trackpad pinch magnifies like Safari; Cmd+scroll changes the page zoom.
    wc.setVisualZoomLevelLimits(1, 4).catch(() => {});
    wc.on("zoom-changed", (_e, direction) => zoomContents(wc, direction));
    // Pop-ups open in the same card's view instead of new windows.
    // Links get where they came from: the card whose pane holds the page, and the page's own URL.
    const from = () => ({ card: key === BOARD ? null : key, page: wc.getURL() });
    wc.setWindowOpenHandler(({ url }) => {
      if (/^weft:/i.test(url)) onLink?.(url, from());
      else wc.loadURL(url).catch(() => {});
      return { action: "deny" };
    });
    // weft:// links in a page (a recipe's past runs, a walk-through's buttons) are the app's, not the page's.
    wc.on("will-navigate", (e, url) => {
      if (!/^weft:/i.test(url)) return;
      e.preventDefault();
      onLink?.(url, from());
    });
    for (const event of ["did-navigate", "did-navigate-in-page", "page-title-updated", "did-start-loading", "did-stop-loading"]) {
      wc.on(event, () => {
        layout();
        if (key === active) sendState();
      });
    }
    // Remembered so the card's page comes back after a restart (electron/pane-pages.cjs).
    if (key !== BOARD) wc.on("did-navigate", () => pages?.record(key, wc.getURL(), wc.getTitle()));
    layout();
    return view;
  }

  // action is "in", "out", "reset", or a percentage. Chromium shares zoom across a host's pages.
  function zoomContents(wc, action) {
    if (!wc || wc.isDestroyed()) return;
    const now = wc.getZoomFactor() * 100;
    const next =
      action === "in" ? stepZoom(now, 1) : action === "out" ? stepZoom(now, -1) : action === "reset" ? 100 : Number(action);
    if (!Number.isFinite(next)) return;
    wc.setZoomFactor(Math.min(500, Math.max(25, next)) / 100);
    if (wc === views.get(active)?.webContents) sendState();
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
    if (active !== BOARD && !visible) restore(active);
  }

  // A card opened with a blank browser (after a restart) gets its last page back, or its last update page.
  function restore(key) {
    const url = pages?.restoreUrl(key);
    if (!url) return;
    open(url, key).catch(() => {
      const fallback = pages.fallbackUrl(key);
      if (fallback && fallback !== url) open(fallback, key).catch(() => {});
    });
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

  // Weft's own server (see self-url.cjs for what counts).
  function isSelf(url) {
    return isSelfUrl(url, getAppView()?.webContents.getURL());
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
    // Loading a page takes keyboard focus; an agent's page shouldn't pull it out of the board mid-typing.
    const boardFocused = Boolean(boardContents()?.isFocused());
    try {
      await v.webContents.loadURL(url);
    } catch (err) {
      // Redirects reject the first load with ERR_ABORTED; the page still loads.
      if (err.code !== "ERR_ABORTED") throw err;
    } finally {
      if (boardFocused && !v.webContents.isDestroyed() && v.webContents.isFocused()) boardContents()?.focus();
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

  // highlight, a CSS selector, scrolls that element into view and draws an orange box around it for the shot
  // (for step-by-step instructions: "click here"), then takes the box away.
  async function screenshot(key = active, highlight) {
    const wc = requirePage(key);
    if (key === active && !visible) setVisible(true);
    let found;
    if (highlight) {
      found = await wc.executeJavaScript(`(() => {
        const el = document.querySelector(${JSON.stringify(String(highlight))});
        if (!el) return false;
        el.scrollIntoView({ block: "center" });
        const r = el.getBoundingClientRect();
        const box = document.createElement("div");
        box.id = "__weft_highlight";
        box.style.cssText = "position:fixed;z-index:2147483647;pointer-events:none;border:3px solid #e8542f;border-radius:8px;box-shadow:0 0 0 4px rgb(232 84 47/.25);" +
          "left:" + (r.left - 6) + "px;top:" + (r.top - 6) + "px;width:" + (r.width + 6) + "px;height:" + (r.height + 6) + "px";
        document.documentElement.appendChild(box);
        return true;
      })()`);
      // Let the scroll and the box paint before the capture.
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    let image;
    try {
      image = await wc.capturePage();
    } finally {
      if (found) await wc.executeJavaScript(`document.getElementById("__weft_highlight")?.remove()`).catch(() => {});
    }
    if (image.getSize().width > 1280) image = image.resize({ width: 1280 });
    return { png: image.toPNG().toString("base64"), ...(highlight ? { found: Boolean(found) } : {}) };
  }

  // A card's thumbnail (lib/card-pictures.ts): a small capture that never shows the pane. A page that
  // isn't on screen may capture empty; that's no thumbnail, not an error.
  async function thumbnail(key) {
    const view = views.get(key);
    if (!view || !view.webContents.getURL()) return { jpg: null };
    let image = await view.webContents.capturePage();
    if (image.isEmpty()) return { jpg: null };
    if (image.getSize().width > 480) image = image.resize({ width: 480, quality: "good" });
    return { jpg: image.toJPEG(78).toString("base64") };
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
      "POST /browser/screenshot": (body) => screenshot(body.key, body.highlight),
      "POST /browser/thumb": (body) => thumbnail(body.key),
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
    zoom: (action) => zoomContents(views.get(active)?.webContents, action),
    // True for any card's page, so the app menu's zoom keys reach the pane's toolbar too.
    owns: (wc) => [...views.values()].some((v) => v.webContents === wc),
    startControlServer,
  };
}

module.exports = { createBrowserPane };
