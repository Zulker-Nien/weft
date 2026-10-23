// Keep Working IPC: bridges electron/keep-working.cjs to the renderer's window.weft.keepWorking
// (electron/preload.cjs). The board's Settings → Laptop mode card is the only consumer; main
// pushes "keep-working:changed" on every state change so the card's deadline can tick without polling.
//
// Every handler answers the board window only (pentest 2026-10-18, F-4), the same gate as
// electron/vault.cjs and electron/terminal.cjs: a pane page or any other renderer that reached ipcRenderer
// could otherwise keep the Mac awake or read its state.
module.exports = function registerKeepWorkingIpc({ ipcMain, keepWorking, getBoardContents }) {
  if (!keepWorking) return;
  const fromBoard = (e) => Boolean(e?.sender) && e.sender === getBoardContents();
  keepWorking.subscribe(() => {
    const board = getBoardContents();
    if (board && !board.isDestroyed()) board.send("keep-working:changed");
  });
  ipcMain.handle("keep-working:state", (e) => (fromBoard(e) ? keepWorking.state() : null));
  ipcMain.handle("keep-working:start", async (e, mode, hours) => {
    if (!fromBoard(e)) return;
    if (mode === "threads" || mode === "hours") await keepWorking.start(mode, hours);
  });
  ipcMain.handle("keep-working:prefs", (e, patch) => {
    if (fromBoard(e)) return keepWorking.setPrefs(patch); // setPrefs keeps only known keys and values
  });
  ipcMain.handle("keep-working:stop", (e) => {
    if (fromBoard(e)) return keepWorking.stop();
  });
};
