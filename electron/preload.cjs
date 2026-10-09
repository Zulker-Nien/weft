const { contextBridge, ipcRenderer } = require("electron");

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
  browser: {
    open: (url) => ipcRenderer.invoke("browser:open", url),
    getState: () => ipcRenderer.invoke("browser:state"),
    setVisible: (visible) => ipcRenderer.send("browser:visible", visible),
    setBounds: (rect) => ipcRenderer.send("browser:bounds", rect),
    back: () => ipcRenderer.send("browser:back"),
    forward: () => ipcRenderer.send("browser:forward"),
    reload: () => ipcRenderer.send("browser:reload"),
    onState: (callback) => listen("browser:state", callback),
  },
  dialog: {
    openFolder: () => ipcRenderer.invoke("dialog:openFolder"),
  },
  openExternal: (url) => ipcRenderer.send("shell:openExternal", url),
  setBadge: (count) => ipcRenderer.send("badge:set", count),
  copilot: {
    toggle: () => ipcRenderer.send("copilot:toggle"),
    onState: (callback) => listen("copilot:state", callback),
  },
  onMenu: (callback) => listen("menu", callback),
  // Buttons on the startup screen when the server fails to start.
  splashAction: (action) => ipcRenderer.send("splash:action", action),
});
