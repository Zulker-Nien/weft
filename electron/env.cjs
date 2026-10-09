// Apps opened from Finder or the Dock get a bare PATH (/usr/bin:/bin:…), so `claude`, `puku-cli`,
// and nvm's `node` wouldn't be found. Read PATH from the user's login shell instead.
const { execFile } = require("node:child_process");

const MARK = "__WEFT_PATH__";

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

async function fixPath() {
  const shellPath = await loginShellPath();
  if (!shellPath) return;
  const parts = [...shellPath.split(":"), ...(process.env.PATH || "").split(":")].filter(Boolean);
  process.env.PATH = [...new Set(parts)].join(":");
}

module.exports = { fixPath };
