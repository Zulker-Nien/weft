// The board's terminal: real shells on a pty (node-pty), driven over IPC by components/TerminalDrawer.tsx.
// A shell outlives the drawer and a page reload: opening one again by id reattaches and replays what it
// printed since, so closing the drawer never loses a running command. Restart kills it for a fresh one.
//
// The IPC handlers are gated to the board window (isBoard), and each session is owned by the
// webContents that opened it: writes, resizes and kills from any other webContents are dropped.
// That's the M-3 narrowing — without it, two renderers (a future copilot thread, a pasted page in
// the pane, an extension of the renderer surface) could race for the same shell id and each one
// would drain output or kill the other's session.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// What a reattached view gets back; enough for a screenful of history without holding a long build log.
const REPLAY_LIMIT = 200_000;

let pty;
function loadPty() {
  if (pty) return pty;
  // node-pty's macOS prebuilds ship spawn-helper without its execute bit, and every spawn fails with
  // "posix_spawnp failed" until it's set (package.json's postinstall also fixes it).
  try {
    const dir = path.join(path.dirname(require.resolve("node-pty/package.json")), "prebuilds", `${process.platform}-${process.arch}`);
    const helper = path.join(dir, "spawn-helper");
    if (fs.existsSync(helper)) fs.chmodSync(helper, 0o755);
  } catch {}
  pty = require("node-pty");
  return pty;
}

// Pure helper extracted from registerTerminal so the ownership / isBoard logic can be unit-tested
// without spinning up node-pty. The session table is just a Map; the only state we look at is
// `ownerId` (a webContents.id) and `sender.id` (a webContents.id). `isBoard(sender)` decides
// whether the message even came from the right window in the first place.
function sessionFor(sessions, isBoard, sender, id) {
  if (!sender) return null;
  if (!isBoard(sender)) return null;
  const session = sessions.get(id);
  if (!session) return null;
  if (session.ownerId !== sender.id) return null;
  return session;
}

function registerTerminal(ipcMain, { isBoard }) {
  // id -> { proc, ownerId, replay, cwd }. ownerId is the webContents.id of the renderer that
  // opened the shell; writes, resizes and kills from a different webContents are dropped.
  const sessions = new Map();

  function send(session, channel, ...args) {
    // Output always goes to the owner. If the owner has gone away (closed the page) we just stop
    // sending — the session keeps running so a reattach picks it up.
    if (!session.ownerId) return;
    const wc = require("electron").webContents.fromId(session.ownerId);
    if (wc && !wc.isDestroyed()) wc.send(channel, ...args);
  }

  function spawn(id, cwd, cols, rows) {
    const shell = process.env.SHELL || (process.platform === "win32" ? "powershell.exe" : "/bin/zsh");
    const dir = cwd && fs.existsSync(cwd) ? cwd : os.homedir();
    const proc = loadPty().spawn(shell, process.platform === "win32" ? [] : ["-l"], {
      name: "xterm-256color",
      cols: cols || 80,
      rows: rows || 24,
      cwd: dir,
      env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor", TERM_PROGRAM: "Weft" },
    });
    const session = { proc, ownerId: null, replay: "", cwd: dir };
    proc.onData((data) => {
      session.replay = (session.replay + data).slice(-REPLAY_LIMIT);
      send(session, "terminal:data", id, data);
    });
    proc.onExit(({ exitCode }) => {
      if (sessions.get(id) !== session) return;
      sessions.delete(id);
      send(session, "terminal:exit", id, exitCode);
    });
    sessions.set(id, session);
    return session;
  }

  // Starts the shell, or reattaches to the one already running under this id.
  ipcMain.handle("terminal:open", (e, id, cwd, cols, rows) => {
    if (!isBoard(e.sender)) return { error: "Terminal only answers the board window." };
    try {
      let session = sessions.get(id);
      const reattached = Boolean(session);
      if (!session) session = spawn(id, cwd, cols, rows);
      // Take over ownership: the latest board view (after a reload, after a card switch) is the
      // one that should see the output. The previous owner's writes would be silently dropped by
      // sessionFor, so this is safe.
      session.ownerId = e.sender.id;
      if (reattached && cols && rows) session.proc.resize(cols, rows);
      return { replay: reattached ? session.replay : "", cwd: session.cwd };
    } catch (err) {
      return { error: String(err.message || err) };
    }
  });
  ipcMain.on("terminal:write", (e, id, data) => {
    const session = sessionFor(sessions, isBoard, e.sender, id);
    if (session) session.proc.write(String(data));
  });
  ipcMain.on("terminal:resize", (e, id, cols, rows) => {
    const session = sessionFor(sessions, isBoard, e.sender, id);
    if (session && cols > 0 && rows > 0) session.proc.resize(cols, rows);
  });
  ipcMain.on("terminal:kill", (e, id) => {
    const session = sessionFor(sessions, isBoard, e.sender, id);
    if (!session) return;
    sessions.delete(id);
    session.proc.kill();
  });

  return function killAll() {
    for (const session of sessions.values()) session.proc.kill();
    sessions.clear();
  };
}

module.exports = { registerTerminal, sessionFor };
