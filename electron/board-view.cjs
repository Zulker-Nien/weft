// Threads see and drive the board window (appView) the way they drive the browser pane: mcp__board_view__*
// (lib/board-view-tools.ts) calls these routes on the pane's token-guarded control server. Only the operations
// below run, each a fixed page script with its selector JSON-encoded in; there's no route for arbitrary JS.
// Secret values stay out of reach: anything marked data-secret (a revealed vault value, the value field) reads
// as ‹secret› and is blanked in screenshots, and controls marked data-secret-action (reveal, copy) can't be
// clicked from here, so a thread can't put a value on the clipboard either (docs/architecture/board-view.md).

const SECRET = "[data-secret]";
const SECRET_ACTION = "[data-secret-action]";
const REDACTED = "‹secret›";
const HIGHLIGHT_ID = "__weft_board_highlight";

// The routes, and nothing else: the allowlist the tests pin.
const OPERATIONS = ["screenshot", "click", "hover", "type", "read"];

// Painted over data-secret for the length of a capture: no text, no caret, a hatched block where the value was.
const BLANK_SECRETS_CSS = `${SECRET}, ${SECRET} * { color: transparent !important; caret-color: transparent !important; text-shadow: none !important; -webkit-text-security: disc !important; }
${SECRET} { background: repeating-linear-gradient(45deg, #8884 0 4px, #8882 4px 8px) !important; }
${SECRET} * { visibility: hidden !important; }`;

function selectorArg(selector, required = true) {
  const s = typeof selector === "string" ? selector.trim() : "";
  if (!s) {
    if (required) throw new Error("A CSS selector is required.");
    return "";
  }
  if (s.length > 500) throw new Error("That selector is too long (500 characters at most).");
  return s;
}

const q = (value) => JSON.stringify(value);
const find = (sel) => `const el = document.querySelector(${q(sel)}); if (!el) return { found: false };`;

// The page side of each operation: a selector in, a small JSON-able answer out.
const scripts = {
  // Where the element's middle sits (scrolled into view), for a real mouse move.
  locate: (sel) =>
    `(() => { ${find(sel)} el.scrollIntoView({ block: "nearest" }); const r = el.getBoundingClientRect(); return { found: true, x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`,
  click: (sel) =>
    `(() => { ${find(sel)} if (el.closest(${q(SECRET_ACTION)})) return { found: true, refused: true }; el.scrollIntoView({ block: "nearest" }); el.click(); return { found: true }; })()`,
  // Focuses a field and selects what's in it, so the typing that follows replaces it.
  focusField: (sel) =>
    `(() => { ${find(sel)} if (!el.matches("input, textarea, [contenteditable]:not([contenteditable='false'])")) return { found: true, refused: true }; el.focus(); if (typeof el.select === "function") el.select(); else document.execCommand("selectAll"); return { found: true }; })()`,
  // The element's visible text with every data-secret value inside the page cut out.
  read: (sel) =>
    `(() => { const el = ${sel ? `document.querySelector(${q(sel)})` : "document.body"}; if (!el) return { found: false };` +
    ` if (el.closest(${q(SECRET)})) return { found: true, text: ${q(REDACTED)} }; let text = el.innerText || "";` +
    ` for (const s of document.querySelectorAll(${q(SECRET)})) { const v = String(s.value || s.innerText || s.textContent || "").trim(); if (v) text = text.split(v).join(${q(REDACTED)}); }` +
    ` return { found: true, text: text.slice(0, 30000) }; })()`,
  highlight: (sel) =>
    `(() => { ${find(sel)} el.scrollIntoView({ block: "nearest" }); const r = el.getBoundingClientRect(); const box = document.createElement("div"); box.id = ${q(HIGHLIGHT_ID)};` +
    ` box.style.cssText = "position:fixed;z-index:2147483647;pointer-events:none;border:3px solid #e8542f;border-radius:8px;box-shadow:0 0 0 4px rgb(232 84 47/.25);left:" + (r.left - 6) + "px;top:" + (r.top - 6) + "px;width:" + (r.width + 6) + "px;height:" + (r.height + 6) + "px";` +
    ` document.documentElement.appendChild(box); return { found: true }; })()`,
  unhighlight: () => `document.getElementById(${q(HIGHLIGHT_ID)})?.remove()`,
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// board() is the board's webContents (appView's), or undefined before it exists.
function createBoardView({ board }) {
  function contents() {
    const wc = board();
    if (!wc || wc.isDestroyed() || !wc.getURL()) throw new Error("The board isn't loaded yet.");
    return wc;
  }

  function miss(selector) {
    return new Error(`No element on the board matches ${selector}`);
  }

  async function screenshot(highlight) {
    const wc = contents();
    const sel = selectorArg(highlight, false);
    const cssKey = await wc.insertCSS(BLANK_SECRETS_CSS);
    let found;
    try {
      if (sel) found = (await wc.executeJavaScript(scripts.highlight(sel))).found;
      // Let the blanking, the scroll and the box paint before the capture.
      await wait(120);
      let image = await wc.capturePage();
      if (image.isEmpty()) throw new Error("The board window captured empty (is it minimized or hidden?).");
      if (image.getSize().width > 1600) image = image.resize({ width: 1600 });
      return { png: image.toPNG().toString("base64"), ...(sel ? { found: Boolean(found) } : {}) };
    } finally {
      if (found) await wc.executeJavaScript(scripts.unhighlight()).catch(() => {});
      await wc.removeInsertedCSS(cssKey).catch(() => {});
    }
  }

  async function click(selector) {
    const sel = selectorArg(selector);
    const r = await contents().executeJavaScript(scripts.click(sel));
    if (!r.found) throw miss(sel);
    if (r.refused) throw new Error(`${sel} reveals or copies a secret value; only you can click that (with Touch ID).`);
    return { clicked: sel };
  }

  // A real mouse move, so CSS :hover (a row's hover buttons) and mouseenter handlers fire.
  async function hover(selector) {
    const sel = selectorArg(selector);
    const wc = contents();
    const r = await wc.executeJavaScript(scripts.locate(sel));
    if (!r.found) throw miss(sel);
    const zoom = wc.getZoomFactor();
    const x = Math.round(r.x * zoom);
    const y = Math.round(r.y * zoom);
    wc.sendInputEvent({ type: "mouseMove", x, y });
    return { hovered: sel, x, y };
  }

  async function type(selector, text) {
    const sel = selectorArg(selector);
    const wc = contents();
    const r = await wc.executeJavaScript(scripts.focusField(sel));
    if (!r.found) throw miss(sel);
    if (r.refused) throw new Error(`${sel} isn't a text field.`);
    await wc.insertText(String(text ?? ""));
    return { typed: sel };
  }

  async function read(selector) {
    const sel = selectorArg(selector, false);
    const wc = contents();
    const r = await wc.executeJavaScript(scripts.read(sel));
    if (!r.found) throw miss(sel);
    return { url: wc.getURL(), title: wc.getTitle(), text: r.text };
  }

  return { screenshot, click, hover, type, read };
}

function boardViewRoutes(view) {
  return {
    "POST /board-view/screenshot": (body) => view.screenshot(body.highlight),
    "POST /board-view/click": (body) => view.click(body.selector),
    "POST /board-view/hover": (body) => view.hover(body.selector),
    "POST /board-view/type": (body) => view.type(body.selector, body.text),
    "POST /board-view/read": (body) => view.read(body.selector),
  };
}

module.exports = { createBoardView, boardViewRoutes, scripts, OPERATIONS, BLANK_SECRETS_CSS, REDACTED };
