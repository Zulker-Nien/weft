// The startup screen (splash.html) the main window shows while the server starts, and its error state
// with Retry, Logs and Quit (main.cjs answers those on "splash:action").
const path = require("node:path");

// CONNECTION_CLOSED, CONNECTION_RESET, CONNECTION_REFUSED, EMPTY_RESPONSE: the server is restarting, not broken.
const TRANSIENT = new Set([-100, -101, -102, -324]);
const MAX_RETRIES = 20;
const RETRY_MS = 500;

// view() and logPath() are read late: the view and the server come and go after this is created.
function createStartupScreen({ view, version, showMain, logPath }) {
  const contents = () => view().webContents;
  const onSplash = () => Boolean(view()) && contents().getURL().startsWith("file:");
  // The version rides in the query string: the splash is a bare file:// page with no bridge.
  const loadSplash = () => contents().loadFile(path.join(__dirname, "splash.html"), { query: { v: version } });

  async function show(status) {
    if (!onSplash()) await loadSplash();
    await contents().executeJavaScript(`setStatus(${JSON.stringify(status)})`).catch(() => {});
  }

  async function fail(message) {
    showMain();
    const detail = logPath() ? ` Details are in ${logPath()}.` : "";
    if (!onSplash()) await loadSplash();
    await contents().executeJavaScript(`showError(${JSON.stringify(message + detail)})`).catch(() => {});
  }

  // A failed load reaches fail() through watch() below, so the splash never sits on "Starting the board…" for good.
  function loadBoard(url) {
    return contents().loadURL(url).catch(() => {});
  }

  // At startup or on ⌘R: the board didn't load, or its renderer died. Show why instead of a blank window.
  // ERR_ABORTED (-3) is a load replaced by another one, such as Fast Refresh's full reload.
  // A dropped connection (next dev restarting after a next.config.ts edit) is retried for ~10s before the error shows.
  function watch(webContents) {
    let retries = 0;
    webContents.on("did-finish-load", () => { retries = 0; });
    webContents.on("did-fail-load", (_e, code, description, url, isMainFrame) => {
      if (!isMainFrame || code === -3 || url.startsWith("file:")) return;
      if (TRANSIENT.has(code) && retries < MAX_RETRIES) {
        retries += 1;
        setTimeout(() => void loadBoard(url), RETRY_MS);
        return;
      }
      retries = 0;
      void fail(`The board didn't load (${description}).`);
    });
    webContents.on("render-process-gone", (_e, { reason }) => {
      if (reason !== "clean-exit") void fail(`The board stopped drawing (${reason}).`);
    });
  }

  return { show, fail, loadBoard, watch };
}

module.exports = { createStartupScreen };
