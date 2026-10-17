// weft://new?prompt=…&folder=…&title=…&cli=puku  opens the New Thread dialog with a pre-filled
// prompt. L-3: the dialog is pre-filled but the user has to click Start, so a clickjacked link
// can't fire a thread. start=1 is ignored on purpose.
const electron = require("electron");
const os = require("node:os");

async function resolveFolder(url, server) {
  const explicit = url.searchParams.get("folder");
  if (explicit) return explicit;
  const settings = await (await fetch(`${server.url}/api/settings`)).json();
  return settings.projects?.[0]?.path ?? os.homedir();
}

function createNewThreadLink({ getServer, getWin, sendMenu, dialog = electron.dialog }) {
  return async function handleNewThreadLink(url) {
    const prompt = url.searchParams.get("prompt");
    if (!prompt) return sendMenu("new-thread");
    try {
      const folder = await resolveFolder(url, getServer());
      const res = await fetch(`${getServer().url}/api/cards`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-threadboard": "1" },
        body: JSON.stringify({
          prompt,
          title: url.searchParams.get("title") ?? undefined,
          cwd: folder,
          backend: url.searchParams.get("cli") === "puku" ? "puku" : "claude",
          start: false,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? res.statusText);
      sendMenu("open-card", data.card.id);
    } catch (err) {
      dialog.showMessageBox(getWin(), { type: "warning", message: "Couldn't create the card", detail: err.message });
    }
  };
}

module.exports = { createNewThreadLink, resolveFolder };
