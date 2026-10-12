// The token the Next server shows the control server (electron/browser-pane.cjs), handed over as a file
// rather than in the server's env: anything running as you can read a process's env (`ps eww`), and the
// threads are the server's children. The file is 0600, new each launch and gone on quit, and
// lib/secret-guard.ts keeps threads from reading it, the same as a .env file. lib/shell-token.ts reads it.
const fs = require("node:fs");
const path = require("node:path");

const FILE = "shell-token";

function writeShellToken(dataDir, token) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, FILE);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, token, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function removeShellToken(dataDir) {
  fs.rmSync(path.join(dataDir, FILE), { force: true });
}

module.exports = { writeShellToken, removeShellToken, SHELL_TOKEN_FILE: FILE };
