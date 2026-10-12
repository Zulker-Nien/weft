// What agents do to a pane page (mcp__browser__click and type_text, and the vault's fill): wc is the page's
// webContents. Both answer { found } so a selector that matches nothing reads as a miss, not an error.

async function click(wc, selector) {
  const found = await wc.executeJavaScript(`(() => {
    const el = document.querySelector(${JSON.stringify(String(selector))});
    if (!el) return false;
    el.scrollIntoView({ block: "center" });
    el.click();
    return true;
  })()`);
  return { found };
}

// Replaces the field's contents: select all, then insert as if typed, so the page's own input handlers run.
async function typeText(wc, selector, text) {
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

module.exports = { click, typeText };
