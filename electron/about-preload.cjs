// The About window's bridge, window.weftAbout. Loaded only into the shell's own about.html,
// never into the board, and every channel behind it checks that the caller is that window.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("weftAbout", {
  info: () => ipcRenderer.invoke("weft-about:info"),
  open: (which) => ipcRenderer.invoke("weft-about:open", which),
  copy: (text) => ipcRenderer.invoke("weft-about:copy", text),
});
