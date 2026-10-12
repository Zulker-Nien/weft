// Where each card's browser was, so a restart puts it back: ~/.weft/pages/index.json, one entry per card,
// shaped like the card_pages rows a cloud sync would upload later. Threads write pages to ~/.weft/show now,
// but a page in a temp folder (older /tmp/weft-show/… ones) is copied beside the index, since macOS clears those.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { fileURLToPath, pathToFileURL } = require("node:url");

const MAX_COPY_BYTES = 20 * 1024 * 1024;
const TEMP_DIRS = ["/tmp", "/private/tmp", "/var/folders", "/private/var/folders", os.tmpdir()];

function kindOf(url) {
  if (/^file:/i.test(url)) return "file";
  if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])([:/]|$)/i.test(url)) return "app";
  return "web";
}

function isTemp(file) {
  return TEMP_DIRS.some((dir) => file === dir || file.startsWith(`${dir}/`));
}

function createPanePages(dataDir) {
  const dir = path.join(dataDir, "pages");
  const indexFile = path.join(dir, "index.json");
  let pages = read();

  function read() {
    try {
      return JSON.parse(fs.readFileSync(indexFile, "utf8"));
    } catch {
      return {};
    }
  }

  function save() {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(indexFile, JSON.stringify(pages, null, 2));
  }

  // A temp file's copy under pages/<card>/, as a file url; undefined when it isn't a temp file or can't be copied.
  function snapshot(cardId, url) {
    try {
      const file = fileURLToPath(url);
      if (!isTemp(file) || fs.statSync(file).size > MAX_COPY_BYTES) return undefined;
      const copy = path.join(dir, cardId, path.basename(file));
      fs.mkdirSync(path.dirname(copy), { recursive: true });
      fs.copyFileSync(file, copy);
      return pathToFileURL(copy).href;
    } catch {
      return undefined;
    }
  }

  function record(cardId, url, title = "") {
    if (!cardId || !url || /^(about|data|blob|chrome-error):/i.test(url)) return;
    const page = { cardId, url, kind: kindOf(url), title, updatedAt: new Date().toISOString() };
    const savedUrl = page.kind === "file" ? snapshot(cardId, url) : undefined;
    if (savedUrl) page.savedUrl = savedUrl;
    pages[cardId] = page;
    try {
      save();
    } catch {}
  }

  // The last page the card's thread opened, for cards whose browser was never recorded (opened before
  // this index existed). Read from threads/<card>.json; undefined when there's none.
  function lastOpened(cardId) {
    try {
      const items = JSON.parse(fs.readFileSync(path.join(dataDir, "threads", `${cardId}.json`), "utf8"));
      for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i];
        if (item?.kind !== "tool" || item.name !== "mcp__browser__open_url" || item.isError) continue;
        const url = /^Opened (\S+)/.exec(item.result ?? "")?.[1] ?? item.summary;
        if (url) return url;
      }
    } catch {}
    return undefined;
  }

  // What to load when the card's browser is blank: its saved copy, the url itself, or (never recorded)
  // the last page its thread opened, which is then recorded so a temp page gets its copy.
  function restoreUrl(cardId) {
    if (!pages[cardId]) {
      const url = lastOpened(cardId);
      if (url) record(cardId, url);
    }
    const page = pages[cardId];
    return page ? page.savedUrl ?? page.url : undefined;
  }

  // If that fails (a dev server that isn't running, a file that's gone): the card's last update page.
  function fallbackUrl(cardId) {
    const glance = path.join(dataDir, "glance", `${cardId}.html`);
    return fs.existsSync(glance) ? pathToFileURL(glance).href : undefined;
  }

  return { record, restoreUrl, fallbackUrl, get: (cardId) => pages[cardId] };
}

module.exports = { createPanePages, kindOf, isTemp };
