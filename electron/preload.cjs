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
  // The secrets vault (electron/vault.cjs). Main answers only the board window, so the copilot's copy of
  // this bridge gets errors; browser-pane pages have no preload at all.
  vault: {
    overview: (folders) => ipcRenderer.invoke("vault:overview", folders),
    scan: (folder) => ipcRenderer.invoke("vault:scan", folder),
    import: (folder, picks) => ipcRenderer.invoke("vault:import", folder, picks),
    reveal: (id, name, environment) => ipcRenderer.invoke("vault:reveal", id, name, environment),
    copy: (id, name, environment) => ipcRenderer.invoke("vault:copy", id, name, environment),
    set: (folder, name, environment, value) => ipcRenderer.invoke("vault:set", folder, name, environment, value),
    copyTo: (id, name, environment, folder) => ipcRenderer.invoke("vault:copy-to", id, name, environment, folder),
    remove: (id, name, environment) => ipcRenderer.invoke("vault:remove", id, name, environment),
    lock: () => ipcRenderer.invoke("vault:lock"),
    writeBack: (folder) => ipcRenderer.invoke("vault:write-back", folder),
    // A managed .env.local was edited by hand: load the vaults again.
    onChange: (callback) => listen("vault:changed", callback),
  },
  // Vercel (electron/vercel.cjs): the token stays in main; links are .vercel/project.json. Board window only.
  vercel: {
    status: (folders) => ipcRenderer.invoke("vercel:status", folders),
    setToken: (token) => ipcRenderer.invoke("vercel:set-token", token),
    forgetToken: () => ipcRenderer.invoke("vercel:forget-token"),
    projects: () => ipcRenderer.invoke("vercel:projects"),
    scopes: () => ipcRenderer.invoke("vercel:scopes"),
    link: (folder, projectId, orgId) => ipcRenderer.invoke("vercel:link", folder, projectId, orgId),
    create: (folder, options) => ipcRenderer.invoke("vercel:create", folder, options),
    unlink: (folder) => ipcRenderer.invoke("vercel:unlink", folder),
  },
  // Supabase (electron/supabase.cjs): the token stays in main; links are supabase/.temp/project-ref. Board window only.
  supabase: {
    status: (folders) => ipcRenderer.invoke("supabase:status", folders),
    setToken: (token) => ipcRenderer.invoke("supabase:set-token", token),
    forgetToken: () => ipcRenderer.invoke("supabase:forget-token"),
    projects: () => ipcRenderer.invoke("supabase:projects"),
    link: (folder, ref) => ipcRenderer.invoke("supabase:link", folder, ref),
    unlink: (folder) => ipcRenderer.invoke("supabase:unlink", folder),
    restore: (ref) => ipcRenderer.invoke("supabase:restore", ref),
  },
  // BlastCP (electron/blastcp.cjs): the sign-in stays in main; links live in Weft's data folder. Board window only.
  blastcp: {
    status: (folders) => ipcRenderer.invoke("blastcp:status", folders),
    connect: () => ipcRenderer.invoke("blastcp:connect"),
    forget: () => ipcRenderer.invoke("blastcp:forget"),
    workspaces: () => ipcRenderer.invoke("blastcp:workspaces"),
    link: (folder, org, property, name) => ipcRenderer.invoke("blastcp:link", folder, org, property, name),
    unlink: (folder) => ipcRenderer.invoke("blastcp:unlink", folder),
  },
  onMenu: (callback) => listen("menu", callback),
  // The board's first cards are on screen; resolves to this launch's timing (electron/startup-timer.cjs).
  startupReady: () => ipcRenderer.invoke("startup:ready"),
  // Buttons on the startup screen when the server fails to start, and "relaunch" to restart Weft.
  splashAction: (action) => ipcRenderer.send("splash:action", action),
});
