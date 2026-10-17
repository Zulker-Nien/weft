// Asks macOS for a folder a thread needs. Downloads is where audio, screenshots and exports land, and macOS (TCC)
// answers "Operation not permitted" to any thread that reads it until Weft is allowed. Only when a thread asks
// (mcp__board__request_folder_access, after such a refusal or when you say to use files there), never on launch:
// listing the folder from main makes macOS show its own "Weft would like to access your Downloads folder" prompt
// the first time; if the answer was already No it never asks again, so a dialog explains it and opens
// Privacy & Security → Files and Folders instead.
const fs = require("node:fs");

const SETTINGS_URL = "x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders";
// What a thread may ask for: its name → the app.getPath() key. Add Documents or Desktop here to allow those too.
const FOLDERS = { downloads: "downloads", documents: "documents", desktop: "desktop" };

/**
 * "granted" when the folder lists, "denied" when macOS refuses, "missing" when there is no such folder.
 * @param {string} dir
 * @param {(dir: string) => Promise<unknown>} [readdir]
 */
async function probe(dir, readdir = fs.promises.readdir) {
  try {
    await readdir(dir);
    return "granted";
  } catch (err) {
    return err?.code === "EPERM" || err?.code === "EACCES" ? "denied" : "missing";
  }
}

/**
 * The app macOS counts when a thread reads a folder: the running binary's own bundle, not the launcher that opened it.
 * Dev Weft is node_modules/electron/dist/Electron.app (the ~/Applications/Weft.app launcher only runs `open -a` on it),
 * so a grant given to a "Weft" entry there doesn't cover it.
 * @param {{ isPackaged?: boolean, getPath: (key: string) => string }} app
 */
function grantee(app) {
  const bundle = /^(.*?\.app)\//.exec(app.getPath("exe"))?.[1];
  return { name: app.isPackaged ? "Weft" : "Electron", path: bundle ?? "" };
}

/**
 * @param {{
 *   app: { isPackaged?: boolean, getPath: (key: string) => string },
 *   dialog: { showMessageBox: (win: unknown, options: object) => Promise<{ response: number }> },
 *   shell: { openExternal: (url: string) => unknown },
 *   window?: () => unknown,
 *   platform?: string,
 *   readdir?: (dir: string) => Promise<unknown>,
 * }} deps
 */
function createFolderAccess({ app, dialog, shell, window = () => undefined, platform = process.platform, readdir }) {
  /**
   * Lists the folder (which makes macOS prompt the first time); if it's still refused, explains and offers Settings.
   * Resolves to what a thread can tell the user: { status: "granted" | "missing" | "denied" | "unsupported" | "unknown", openedSettings? }.
   */
  async function ask(folder) {
    const key = FOLDERS[String(folder ?? "").trim().toLowerCase()];
    if (!key) return { status: "unknown", folders: Object.keys(FOLDERS) };
    if (platform !== "darwin") return { status: "unsupported" };
    const status = await probe(app.getPath(key), readdir);
    if (status !== "denied") return { status };
    const name = key[0].toUpperCase() + key.slice(1);
    const who = grantee(app);
    const { response } = await dialog.showMessageBox(window(), {
      type: "info",
      message: `Allow Weft to read your ${name} folder`,
      detail:
        `A thread asked for files in ${name}, and macOS is blocking it for ${who.name}${who.path ? ` (${who.path})` : ""}. ` +
        `Turn on “${name} Folder” (under Files and Folders) or Full Disk Access for ${who.name}, then restart Weft.` +
        (app.isPackaged ? "" : " A “Weft” entry in the list is the launcher, a different app: macOS counts the one that's running."),
      buttons: ["Open Settings", "Not now"],
      defaultId: 0,
      cancelId: 1,
    });
    const openedSettings = response === 0;
    if (openedSettings) shell.openExternal(SETTINGS_URL);
    return { status, openedSettings, grantee: who.name };
  }

  return { ask };
}

module.exports = { createFolderAccess, grantee, probe, FOLDERS, SETTINGS_URL };
