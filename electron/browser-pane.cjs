// The side browser pane: a native view laid over the board where the board's placeholder sits.
// The board drives it over IPC; agents drive it through a token-protected control server on
// 127.0.0.1 (see lib/browser-tools.ts).
const { WebContentsView } = require("electron");
const http = require("node:http");

function createBrowserPane({ getWindow, getAppView, token, onContents }) {
  let view;
  let visible = false;
  let bounds = { x: 0, y: 0, width: 0, height: 0 };

  function state() {
    const wc = view?.webContents;
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
    if (!view) return;
    view.setBounds(bounds);
    // Until a page loads, the board shows its own placeholder instead of a blank view.
    const hasPage = Boolean(view.webContents.getURL());
    view.setVisible(visible && hasPage && bounds.width > 0 && bounds.height > 0);
  }

  function ensure() {
    if (view) return view;
    view = new WebContentsView({
      webPreferences: { partition: "persist:threadboard-browser", sandbox: true, contextIsolation: true },
    });
    view.setBackgroundColor("#ffffff");
    getWindow().contentView.addChildView(view);
    const wc = view.webContents;
    onContents?.(wc);
    // Pop-ups open in the pane instead of new windows.
    wc.setWindowOpenHandler(({ url }) => {
      wc.loadURL(url).catch(() => {});
      return { action: "deny" };
    });
    for (const event of ["did-navigate", "did-navigate-in-page", "page-title-updated", "did-start-loading", "did-stop-loading"]) {
      wc.on(event, () => {
        layout();
        sendState();
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

  async function open(raw) {
    const url = normalizeUrl(raw);
    const v = ensure();
    setVisible(true);
    try {
      await v.webContents.loadURL(url);
    } catch (err) {
      // Redirects reject the first load with ERR_ABORTED; the page still loads.
      if (err.code !== "ERR_ABORTED") throw err;
    }
    return { url: v.webContents.getURL(), title: v.webContents.getTitle() };
  }

  function requirePage() {
    if (!view || !view.webContents.getURL()) throw new Error("The browser pane has no page open yet. Use open_url first.");
    return view.webContents;
  }

  async function pageText() {
    const wc = requirePage();
    const text = await wc.executeJavaScript("document.body ? document.body.innerText : ''");
    return { url: wc.getURL(), title: wc.getTitle(), text: String(text).slice(0, 30_000) };
  }

  async function screenshot() {
    const wc = requirePage();
    if (!visible) setVisible(true);
    let image = await wc.capturePage();
    if (image.getSize().width > 1280) image = image.resize({ width: 1280 });
    return { png: image.toPNG().toString("base64") };
  }

  async function click(selector) {
    const wc = requirePage();
    const found = await wc.executeJavaScript(`(() => {
      const el = document.querySelector(${JSON.stringify(String(selector))});
      if (!el) return false;
      el.scrollIntoView({ block: "center" });
      el.click();
      return true;
    })()`);
    return { found };
  }

  async function typeText(selector, text) {
    const wc = requirePage();
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
      "POST /browser/open": (body) => open(body.url),
      "GET /browser/text": () => pageText(),
      "GET /browser/screenshot": () => screenshot(),
      "POST /browser/click": (body) => click(body.selector),
      "POST /browser/type": (body) => typeText(body.selector, body.text),
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
    webContents: () => view?.webContents,
    back: () => view?.webContents.navigationHistory.goBack(),
    forward: () => view?.webContents.navigationHistory.goForward(),
    reload: () => view?.webContents.reload(),
    startControlServer,
  };
}

module.exports = { createBrowserPane };
