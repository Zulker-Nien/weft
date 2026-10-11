const { contextBridge, ipcRenderer, webFrame } = require("electron");

function listen(channel, callback) {
  const listener = (_event, ...args) => callback(...args);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.off(channel, listener);
}

// The UI's only door into the shell: the side browser pane, the copilot window, native dialogs,
// and menu, dock, tray, and shortcut actions.
contextBridge.exposeInMainWorld("threadboard", {
  desktop: true,
  platform: process.platform,
  // The page's zoom (View > Zoom In/Out); the traffic lights don't zoom, so the title bar scales back.
  zoomFactor: () => webFrame.getZoomFactor(),
  browser: {
    open: (url, key) => ipcRenderer.invoke("browser:open", url, key),
    setActive: (key) => ipcRenderer.send("browser:active", key),
    prune: (keys) => ipcRenderer.send("browser:prune", keys),
    getState: () => ipcRenderer.invoke("browser:state"),
    setVisible: (visible) => ipcRenderer.send("browser:visible", visible),
    setBounds: (rect) => ipcRenderer.send("browser:bounds", rect),
    back: () => ipcRenderer.send("browser:back"),
    forward: () => ipcRenderer.send("browser:forward"),
    reload: () => ipcRenderer.send("browser:reload"),
    zoom: (action) => ipcRenderer.send("browser:zoom", action),
    onState: (callback) => listen("browser:state", callback),
  },
  dialog: {
    openFolder: () => ipcRenderer.invoke("dialog:openFolder"),
  },
  openExternal: (url) => ipcRenderer.send("shell:openExternal", url),
  revealFolder: (folder) => ipcRenderer.send("shell:reveal", folder),
  popupMenu: (items) => ipcRenderer.invoke("menu:popup", items),
  setBadge: (count) => ipcRenderer.send("badge:set", count),
  copilot: {
    toggle: () => ipcRenderer.send("copilot:toggle"),
    onState: (callback) => listen("copilot:state", callback),
  },
  // The terminal drawer's shells (electron/terminal.cjs).
  terminal: {
    open: (id, cwd, cols, rows) => ipcRenderer.invoke("terminal:open", id, cwd, cols, rows),
    write: (id, data) => ipcRenderer.send("terminal:write", id, data),
    resize: (id, cols, rows) => ipcRenderer.send("terminal:resize", id, cols, rows),
    kill: (id) => ipcRenderer.send("terminal:kill", id),
    onData: (callback) => listen("terminal:data", callback),
    onExit: (callback) => listen("terminal:exit", callback),
  },
  onMenu: (callback) => listen("menu", callback),
  // Buttons on the startup screen when the server fails to start.
  splashAction: (action) => ipcRenderer.send("splash:action", action),
});
