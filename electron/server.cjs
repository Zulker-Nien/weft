// Runs the Next.js server and keeps it running: restarts it if it crashes, and writes its output
// to a log file. Three modes: `next dev` (npm run desktop), `next start` (npm run app), and the
// standalone server bundled inside the packaged app, run with Electron's own Node.
const { app } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const MAX_LOG_BYTES = 5 * 1024 * 1024;
const MAX_RESTARTS = 3;
const RESTART_WINDOW_MS = 2 * 60_000;

function logFile() {
  const file = path.join(app.getPath("logs"), "server.log");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    if (fs.statSync(file).size > MAX_LOG_BYTES) fs.renameSync(file, `${file}.old`);
  } catch {}
  return file;
}

function portIsFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
  });
}

async function pickPort(preferred) {
  if (await portIsFree(preferred)) return preferred;
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function waitForServer(url, timeoutMs = 120_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`The server didn't start at ${url}`);
}

function command(port) {
  if (app.isPackaged) {
    const serverJs = path.join(process.resourcesPath, "server", "server.js");
    // Run it as "Weft Helper", so macOS doesn't see a second Weft app (and quitting by name works).
    const name = app.getName();
    const helper = path.join(process.resourcesPath, "..", "Frameworks", `${name} Helper.app`, "Contents", "MacOS", `${name} Helper`);
    return {
      bin: fs.existsSync(helper) ? helper : process.execPath,
      args: [serverJs],
      cwd: path.dirname(serverJs),
      env: { ELECTRON_RUN_AS_NODE: "1", NODE_ENV: "production", PORT: String(port), HOSTNAME: "127.0.0.1" },
    };
  }
  const nextBin = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");
  const mode = process.env.THREADBOARD_PROD ? "start" : "dev";
  return {
    bin: process.env.npm_node_execpath || "node",
    args: [nextBin, mode, "-H", "127.0.0.1", "-p", String(port)],
    cwd: ROOT,
    env: {},
  };
}

// Starts the server and supervises it. onStatus(text) reports restarts; onFatal(message) fires after
// repeated crashes. Returns { url, stop, restart, logPath }.
async function startServer({ preferredPort, env, onStatus, onFatal }) {
  const port = await pickPort(preferredPort);
  const url = `http://127.0.0.1:${port}`;
  const logPath = logFile();
  const log = fs.createWriteStream(logPath, { flags: "a" });
  let proc;
  let stopping = false;
  let ready = false;
  let crashes = [];
  let failStart;
  const startFailed = new Promise((_, reject) => (failStart = reject));
  startFailed.catch(() => {});

  function launch() {
    const { bin, args, cwd, env: modeEnv } = command(port);
    log.write(`\n--- ${new Date().toISOString()} starting: ${path.basename(bin)} ${args.join(" ")}\n`);
    const child = spawn(bin, args, { cwd, env: { ...process.env, ...env, ...modeEnv }, stdio: ["ignore", "pipe", "pipe"] });
    proc = child;
    for (const stream of [child.stdout, child.stderr]) {
      stream.on("data", (chunk) => {
        log.write(chunk);
        if (!app.isPackaged) process.stdout.write(chunk);
      });
    }
    child.on("exit", (code, signal) => {
      log.write(`--- server exited (code ${code}, signal ${signal})\n`);
      // Ignore a process that was stopped on purpose or already replaced.
      if (stopping || proc !== child) return;
      const now = Date.now();
      crashes = [...crashes.filter((t) => now - t < RESTART_WINDOW_MS), now];
      if (crashes.length > MAX_RESTARTS) {
        const message = `The server stopped ${crashes.length} times in two minutes.`;
        if (ready) onFatal?.(message);
        else failStart(new Error(message));
        return;
      }
      onStatus?.("Restarting…");
      setTimeout(launch, 500);
    });
  }

  launch();
  await Promise.race([waitForServer(`${url}/api/cards`), startFailed]);
  ready = true;

  return {
    url,
    logPath,
    stop() {
      stopping = true;
      proc?.kill();
    },
    async restart() {
      const old = proc;
      proc = undefined;
      old?.kill();
      crashes = [];
      launch();
      await waitForServer(`${url}/api/cards`);
    },
  };
}

module.exports = { startServer };
