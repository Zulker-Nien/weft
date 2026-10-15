// Keep Working IPC: bridges electron/keep-working.cjs to the renderer's window.threadboard.keepWorking
// (electron/preload.cjs). The board's Settings → General → Laptop mode card is the only consumer; main
// pushes "keep-working:changed" on every state change so the card's deadline can tick without polling.
module.exports = function registerKeepWorkingIpc({ ipcMain, keepWorking, getBoardContents }) {
  if (!keepWorking) return;
  keepWorking.subscribe(() => {
    const board = getBoardContents();
    if (board && !board.isDestroyed()) board.send("keep-working:changed");
  });
  ipcMain.handle("keep-working:state", () => keepWorking.state());
  ipcMain.handle("keep-working:start", async (_e, mode, hours) => {
    if (mode === "threads" || mode === "hours") await keepWorking.start(mode, hours);
  });
  ipcMain.handle("keep-working:stop", () => keepWorking.stop());
};
