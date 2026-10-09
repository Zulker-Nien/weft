// Frees a dev port before a server starts: kills whatever listens on it and deletes the Next build
// folder that server wrote, so two servers never share one `.next` and trigger each other's rebuilds.
//   node electron/free-port.cjs <port> [distDir]      (distDir is relative to the repo root)
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

function listeners(port) {
  try {
    const out = execFileSync("lsof", ["-nP", "-t", `-iTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" });
    return out.split("\n").filter(Boolean).map(Number);
  } catch {
    return []; // lsof exits 1 when nothing listens
  }
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function freePort(port, distDir) {
  for (const signal of ["SIGTERM", "SIGKILL"]) {
    const pids = listeners(port).filter((pid) => pid !== process.pid);
    if (!pids.length) break;
    for (const pid of pids) {
      console.log(`[weft] port ${port} is held by pid ${pid}; sending ${signal}`);
      try {
        process.kill(pid, signal);
      } catch {}
    }
    sleep(500);
  }
  if (distDir) fs.rmSync(path.join(ROOT, distDir), { recursive: true, force: true });
}

module.exports = { freePort };

if (require.main === module) {
  const [port, distDir] = process.argv.slice(2);
  if (!Number(port)) {
    console.error("usage: node electron/free-port.cjs <port> [distDir]");
    process.exit(2);
  }
  freePort(Number(port), distDir);
}
