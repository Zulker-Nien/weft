// Splash IPC (electron/startup-screen.cjs): the start screen's button row, the launch timing handshake
// and the dock-badge count. Lives in its own file so main.cjs can stay focused on the shell, the windows
// and the lifecycle. Mirrors electron/keep-working-ipc.cjs.

module.exports = function registerStartupIpc({ ipcMain, app, shell, boot, timer, startup, getServer, getMenus }) {
  // The board's first cards are on screen: save this launch's timing and tell the board if it ran slow.
  ipcMain.handle("startup:ready", () => timer.finish());
  ipcMain.on("badge:set", (_e, count) => getMenus().refreshWaiting(Number(count) || 0));
  ipcMain.on("splash:action", async (_e, action) => {
    // "relaunch": a drawer whose main side arrived after launch (BlastCP) starts Weft again on the new code.
    if (action === "relaunch") app.relaunch();
    if (action === "quit" || action === "relaunch") return app.quit();
    if (action === "logs") return shell.openPath(app.getPath("logs"));
    if (action !== "retry") return;
    const server = getServer();
    if (!server) return boot();
    await startup.show("Restarting…");
    try {
      await server.restart();
      await startup.loadBoard(server.url);
    } catch (err) {
      startup.fail(err.message);
    }
  });
};
