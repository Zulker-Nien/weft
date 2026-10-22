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

function parentOf(pid) {
  try {
    return Number(execFileSync("ps", ["-o", "ppid=", "-p", String(pid)], { encoding: "utf8" }).trim());
  } catch {
    return 0;
  }
}

// Under Vitest only the test's own children may be signalled: a test that reached the real freePort
// on 1024 once SIGTERMed Weft's live server and deleted its .next (2026-10-22).
function mayKill(pid) {
  if (pid === process.pid) return false;
  return !process.env.VITEST || parentOf(pid) === process.pid;
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// The build folder goes only when a stale server held the port: on a normal launch it keeps
// Turbopack's cache (.next/dev/cache), so the board compiles warm.
function freePort(port, distDir) {
  let evicted = false;
  for (const signal of ["SIGTERM", "SIGKILL"]) {
    const pids = listeners(port).filter(mayKill);
    if (!pids.length) break;
    evicted = true;
    for (const pid of pids) {
      console.log(`[weft] port ${port} is held by pid ${pid}; sending ${signal}`);
      try {
        process.kill(pid, signal);
      } catch {}
    }
    sleep(500);
  }
  if (distDir && evicted) fs.rmSync(path.join(ROOT, distDir), { recursive: true, force: true });
}

module.exports = { freePort, mayKill };

if (require.main === module) {
  const [port, distDir] = process.argv.slice(2);
  if (!Number(port)) {
    console.error("usage: node electron/free-port.cjs <port> [distDir]");
    process.exit(2);
  }
  freePort(Number(port), distDir);
}
