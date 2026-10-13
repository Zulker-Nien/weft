// Apps opened from Finder or the Dock get a bare PATH (/usr/bin:/bin:…), so `claude`, `puku-cli`,
// and nvm's `node` wouldn't be found. Read PATH from the user's login shell instead.
// An interactive login shell takes about a second (it runs ~/.zshrc), and the server can't start
// before PATH is set, so the last one read is saved in ~/.weft/shell-path and used straight away;
// the shell is still asked in the background, ready for the next launch.
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const MARK = "__WEFT_PATH__";

function defaultCacheFile() {
  return path.join(process.env.THREADBOARD_DATA || path.join(os.homedir(), ".weft"), "shell-path");
}

function loginShellPath() {
  const shell = process.env.SHELL || "/bin/zsh";
  return new Promise((resolve) => {
    execFile(
      shell,
      ["-ilc", `printf '${MARK}%s${MARK}' "$PATH"`],
      { encoding: "utf8", timeout: 10_000, env: process.env },
      (err, stdout) => {
        const match = String(stdout || "").match(new RegExp(`${MARK}(.*)${MARK}`, "s"));
        resolve(err && !match ? undefined : match?.[1]);
      },
    );
  });
}

function applyPath(shellPath) {
  const parts = [...shellPath.split(":"), ...(process.env.PATH || "").split(":")].filter(Boolean);
  process.env.PATH = [...new Set(parts)].join(":");
}

function readCache(file) {
  try {
    return fs.readFileSync(file, "utf8").trim() || undefined;
  } catch {
    return undefined;
  }
}

function writeCache(file, shellPath) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, shellPath);
  } catch {}
}

// Resolves once PATH is usable: at once with a saved PATH, otherwise after the shell answers.
async function fixPath({ cacheFile = defaultCacheFile(), readShell = loginShellPath } = {}) {
  const cached = readCache(cacheFile);
  const fresh = readShell().then((shellPath) => {
    if (!shellPath) return;
    applyPath(shellPath);
    if (shellPath !== cached) writeCache(cacheFile, shellPath);
  });
  if (cached) {
    applyPath(cached);
    return;
  }
  await fresh;
}

// Weft.app's own node, pnpm, npm, puku-cli and claude (scripts/bundle-toolchain.mjs) go at the END of PATH:
// the Mac's own tools always win, and these fill in only what's missing on a fresh Mac. A later fixPath()
// refresh puts the shell's PATH first and keeps this entry after it.
function appendToolchain(binDir, { exists = fs.existsSync } = {}) {
  if (!binDir || !exists(binDir)) return false;
  const parts = (process.env.PATH || "").split(":").filter((part) => part && part !== binDir);
  process.env.PATH = [...parts, binDir].join(":");
  return true;
}

module.exports = { fixPath, appendToolchain };
