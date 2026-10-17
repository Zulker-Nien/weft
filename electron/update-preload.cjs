// The Software Update window's bridge, window.weftUpdate. Loaded only into the shell's own update.html,
// and every channel behind it checks that the caller is that window (update-window.cjs).
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("weftUpdate", {
  view: () => ipcRenderer.invoke("weft-update:view"),
  act: (action) => ipcRenderer.invoke("weft-update:act", action),
  onChange: (fn) => ipcRenderer.on("weft-update:changed", (_event, view) => fn(view)),
});
