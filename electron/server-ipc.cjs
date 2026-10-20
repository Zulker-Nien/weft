// Server IPC: the bridge from the board's window to the dev server supervisor (electron/server.cjs).
// Mirrors electron/keep-working-ipc.cjs — the board window is the only sender allowed through every
// handler (pentest 2026-10-18, F-4). Used by ServerErrorBar (components/ServerErrorBar.tsx) for the
// three buttons that show up when the dev server's restart budget trips after the board is up:
// "Restart server" → server:retry, "Open logs" → server:open-logs, "Fix with a thread" →
// weft:create-fix-card, which queues a weft://new link so the user gets the New thread dialog
// pre-filled once the server is back.
const path = require("node:path");
const { readTail } = require("./server-log.cjs");

module.exports = function registerServerIpc({ ipcMain, getServer, getBoardContents, getHandleLink, logPath, shell }) {
  const fromBoard = (e) => Boolean(e?.sender) && e.sender === getBoardContents();

  ipcMain.handle("server:retry", async (e) => {
    if (!fromBoard(e)) return;
    const server = getServer();
    if (!server) return;
    await server.restart();
    return { ok: true };
  });

  ipcMain.handle("server:log-tail", (e) => {
    if (!fromBoard(e)) return "";
    const file = logPath?.();
    if (!file) return "";
    return readTail(file);
  });

  // Reveals the dev server log in Finder, the same way the splash's "Open logs" button does.
  ipcMain.handle("server:open-logs", (e) => {
    if (!fromBoard(e)) return;
    const file = logPath?.();
    if (file) shell?.showItemInFolder?.(file);
  });

  // Queues a weft://new?… link that the user gets once the server is back. Folder is the Weft
  // repo; the dialog pre-fills the prompt with the fatal and the last 4 KB of server.log so the
  // thread has the context to act. The dialog is unstarted (L-3 in electron/new-thread-link.cjs):
  // the user reads it and clicks Start.
  ipcMain.handle("weft:create-fix-card", (e) => {
    if (!fromBoard(e)) return;
    const handleLink = getHandleLink?.();
    if (!handleLink) return;
    const file = logPath?.();
    const tail = file ? readTail(file) : "";
    const message = "Weft's dev server keeps crashing (more in the conversation). Restart it, or fix the root cause and report what you did. Tail of server.log:";
    const prompt = `${message}\n\n${tail.slice(-3000)}`;
    const params = new URLSearchParams({
      prompt,
      title: "Fix the dev server",
      folder: path.join(__dirname, ".."),
    });
    handleLink(`weft://new?${params.toString()}`);
  });
};
