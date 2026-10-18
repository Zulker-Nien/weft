// The browser pane's page bridge for data mini apps (docs/architecture/mini-apps.md): exposes
// window.weft = { access, requestAccess, revoke, read } on file: pages only. The four methods
// land in Electron main's app-data.cjs, which checks the sender's frame, realpath, manifest
// and grant before doing anything; this preload is just a typed door that never runs outside
// a `file:` URL. A page on https:// or about: never sees window.weft and falls back to its
// "Open this app in Weft on your Mac to load its data." message.
const { contextBridge, ipcRenderer } = require("electron");

// We only expose on a `file:` page; WebKit reports the URL through the standard location.
if (typeof location !== "undefined" && location.protocol === "file:") {
  contextBridge.exposeInMainWorld("weft", {
    access: () => ipcRenderer.invoke("app-data:access"),
    requestAccess: () => ipcRenderer.invoke("app-data:request"),
    revoke: () => ipcRenderer.invoke("app-data:revoke"),
    read: (name, args) => ipcRenderer.invoke("app-data:read", String(name ?? ""), args ?? null),
  });
}
