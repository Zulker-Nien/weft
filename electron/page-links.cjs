// weft:// links a thread's own page in the browser pane follows to act on its thread:
// weft://reply?text=…   send text as your reply (a walk-through's Skip and "Tell me what to change")
// weft://commit?message=…&path=…&path=…&push=1&done=<card id>&change=3&label=…
//                       commit those paths with no turn (the commit walk-through's Commit buttons, lib/pile-commit.ts)
// Only a local file page (one a thread wrote) in that card's own pane can, so no website can talk to a thread.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { fileURLToPath } = require("node:url");

// ~/.weft is where Weft and its threads write pages (show/, pages/, apps/); a file from anywhere else (a download) isn't theirs.
const WEFT_DIR = path.join(os.homedir(), ".weft");

function ownPage(from, weftDir = WEFT_DIR) {
  if (!from?.card || typeof from.page !== "string" || !from.page.startsWith("file:")) return false;
  try {
    // realpath, so a symlink inside ~/.weft that points elsewhere doesn't count.
    const file = fs.realpathSync(fileURLToPath(from.page));
    return file.startsWith(fs.realpathSync(weftDir) + path.sep);
  } catch {
    return false;
  }
}

// The link's query as the commit route's body (app/api/cards/[id]/commit), checked there.
function commitBody(raw) {
  const params = new URL(raw).searchParams;
  const body = { message: params.get("message"), paths: params.getAll("path") };
  for (const key of ["push", "done", "change", "label"]) body[key] = params.get(key);
  return body;
}

// Tells a card's page what its link did, as a DOM event the page listens for. Only while the card still
// shows that page, so a result never lands on another one.
function notify(wc, page, name, detail) {
  if (!wc || wc.isDestroyed() || wc.getURL() !== page) return;
  const event = `new CustomEvent(${JSON.stringify(String(name))}, { detail: ${JSON.stringify(detail ?? null)} })`;
  wc.executeJavaScript(`window.dispatchEvent(${event})`).catch(() => {});
}

// getServer: the board's server ({ url }) once it's up. contentsFor: a card's pane page (webContents).
// warn: tells the user something didn't go through.
function createPageLinks({ getServer, contentsFor, warn, weftDir = WEFT_DIR }) {
  async function post(card, route, body) {
    const res = await fetch(`${getServer().url}/api/cards/${encodeURIComponent(card)}/${route}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-weft-token": "1" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? res.statusText);
    return data;
  }

  async function reply(raw, from) {
    const text = new URL(raw).searchParams.get("text")?.trim();
    if (!getServer() || !text || !ownPage(from, weftDir)) return;
    try {
      await post(from.card, "messages", { text });
    } catch (err) {
      warn("Couldn't send that to the thread", err.message);
    }
  }

  // The board commits, pushes and moves the card; the page hears back as a `weft-commit` event.
  async function commit(raw, from) {
    if (!getServer() || !ownPage(from, weftDir)) return;
    const body = commitBody(raw);
    let result;
    try {
      result = (await post(from.card, "commit", body)).result;
    } catch (err) {
      result = { ok: false, change: body.change, error: err.message };
    }
    notify(contentsFor(from.card), from.page, "weft-commit", result);
  }

  // Follows a page's own link; false for every other weft:// link.
  function handle(url, from) {
    if (/^weft:\/\/reply\b/i.test(url)) void reply(url, from);
    else if (/^weft:\/\/commit\b/i.test(url)) void commit(url, from);
    else return false;
    return true;
  }

  return { handle, reply, commit };
}

module.exports = { createPageLinks, commitBody, notify, ownPage };
