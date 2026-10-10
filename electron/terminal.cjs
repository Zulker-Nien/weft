// The board's terminal: real shells on a pty (node-pty), driven over IPC by components/TerminalDrawer.tsx.
// A shell outlives the drawer and a page reload: opening one again by id reattaches and replays what it
// printed since, so closing the drawer never loses a running command. Restart kills it for a fresh one.
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

function registerTerminal(ipcMain) {
  const sessions = new Map(); // id -> { proc, sender, replay, cwd }

  function send(session, channel, ...args) {
    if (session.sender && !session.sender.isDestroyed()) session.sender.send(channel, ...args);
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
    const session = { proc, sender: null, replay: "", cwd: dir };
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
    try {
      let session = sessions.get(id);
      const reattached = Boolean(session);
      if (!session) session = spawn(id, cwd, cols, rows);
      session.sender = e.sender;
      if (reattached && cols && rows) session.proc.resize(cols, rows);
      return { replay: reattached ? session.replay : "", cwd: session.cwd };
    } catch (err) {
      return { error: String(err.message || err) };
    }
  });
  ipcMain.on("terminal:write", (_e, id, data) => sessions.get(id)?.proc.write(String(data)));
  ipcMain.on("terminal:resize", (_e, id, cols, rows) => {
    if (cols > 0 && rows > 0) sessions.get(id)?.proc.resize(cols, rows);
  });
  ipcMain.on("terminal:kill", (_e, id) => {
    const session = sessions.get(id);
    if (!session) return;
    sessions.delete(id);
    session.proc.kill();
  });

  return function killAll() {
    for (const session of sessions.values()) session.proc.kill();
    sessions.clear();
  };
}

module.exports = { registerTerminal };
