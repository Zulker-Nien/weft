// What a card's browser shows when a page fails to load. Chromium paints a failed load as a blank white
// page with no word of why, so a dev server that stopped left cards looking empty. pane-error.html says
// what went wrong, offers Try again and the card's last page, and reloads by itself once a local dev
// server answers again. Everything it shows rides in its query string: it's a bare file:// page.
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const PAGE = pathToFileURL(path.join(__dirname, "pane-error.html")).href;

// Chromium's net error codes (net/base/net_error_list.h) that read better as a sentence.
const CONNECTION_REFUSED = -102;
const NAME_NOT_RESOLVED = -105;
const INTERNET_DISCONNECTED = -106;
const FILE_NOT_FOUND = -6;
const ABORTED = -3;

function isLocal(url) {
  try {
    const { protocol, hostname } = new URL(url);
    return /^https?:$/.test(protocol) && ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
  } catch {
    return false;
  }
}

// The heading and the line under it; wait is true when the page should keep trying by itself.
function describeFailure({ url, code, description }) {
  let host = url;
  try {
    host = new URL(url).host || url;
  } catch {}
  if (code === CONNECTION_REFUSED && isLocal(url)) {
    return {
      title: `Nothing is running at ${host}`,
      hint: "The dev server isn't running. Start it again (or ask the thread to) and this page reloads by itself.",
      wait: true,
    };
  }
  if (code === CONNECTION_REFUSED) return { title: `${host} refused to connect`, hint: description, wait: false };
  if (code === FILE_NOT_FOUND) return { title: "This page's file is gone", hint: "It was moved or deleted after the thread opened it.", wait: false };
  if (code === NAME_NOT_RESOLVED) return { title: `Can't find ${host}`, hint: "Check the address, or your connection.", wait: false };
  if (code === INTERNET_DISCONNECTED) return { title: "You're offline", hint: "Reconnect and try again.", wait: false };
  return { title: "This page didn't load", hint: description || `Error ${code}`, wait: isLocal(url) };
}

// The error page's url for a failed load of `url`; back is the card's last good page, when it has one.
function errorPageUrl({ url, code, description, back }) {
  const { title, hint, wait } = describeFailure({ url, code, description });
  const query = new URLSearchParams({ url, title, hint, reason: description || String(code) });
  if (wait) query.set("wait", "1");
  if (back && back !== url) query.set("back", back);
  return `${PAGE}?${query}`;
}

// The url that failed, when `current` is the error page; undefined for any other page.
function failedUrl(current) {
  if (!current || !current.startsWith(`${PAGE}?`)) return undefined;
  return new URL(current).searchParams.get("url") ?? undefined;
}

// Shows the error page in place of Chromium's blank one. ERR_ABORTED is a load another load replaced
// (a redirect, a newer open), not a failure; a failed error page itself is left alone so it can't loop.
/**
 * @param {{ back?: (url: string) => string | undefined }} [options]
 */
function watchLoadFailures(webContents, options = {}) {
  webContents.on("did-fail-load", (_e, code, description, url, isMainFrame) => {
    if (!isMainFrame || code === ABORTED || !url || failedUrl(url) !== undefined || url.startsWith(PAGE)) return;
    webContents.loadURL(errorPageUrl({ url, code, description, back: options.back?.(url) })).catch(() => {});
  });
}

module.exports = { describeFailure, errorPageUrl, failedUrl, watchLoadFailures, PAGE };
