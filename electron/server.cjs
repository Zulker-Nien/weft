// Runs the Next.js server and keeps it running: restarts it if it crashes, and writes its output
// to a log file. Three modes: `next dev` (npm run desktop), `next start` (npm run app), and the
// standalone server bundled inside the packaged app, run with Electron's own Node.
const { app } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

const { freePort } = require("./free-port.cjs");

const ROOT = path.join(__dirname, "..");
const MAX_LOG_BYTES = 5 * 1024 * 1024;
const MAX_RESTARTS = 3;
const RESTART_WINDOW_MS = 2 * 60_000;
const RECOVER_GRACE_MS = 500;

// Tail of the child's stdout/stderr to inspect for recoverable errors. The pure parser that backs
// this lives at `lib/dev-server.ts`; this inline copy is a few lines so the main process doesn't
// need a TS loader. lib/dev-server.test.ts is the contract.
const TAIL_BYTES = 4 * 1024;
const PEER_RE = /Another next dev server is already running\.[\s\S]*?- Local:\s+http:\/\/127\.0\.0\.1:(\d+)[\s\S]*?- PID:\s+(\d+)/;
const MISSING_RE = /Module not found: Can't resolve ['"]([^'"]+)['"]/g;
const RELATIVE_PROBES = ["", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx", "/index.js", "/index.jsx"];

function tailOf(buf) {
  if (buf.length <= TAIL_BYTES) return buf;
  return buf.slice(buf.length - TAIL_BYTES);
}

function readTail(file) {
  // The log is append-only and small (capped at MAX_LOG_BYTES). Read the last TAIL_BYTES and
  // decode; if the file is gone or unreadable, return an empty buffer so we fall through to
  // the existing crash counter.
  try {
    const stat = fs.statSync(file);
    const start = Math.max(0, stat.size - TAIL_BYTES);
    const fd = fs.openSync(file, "r");
    try {
      const len = stat.size - start;
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, start);
      return buf.toString("utf8");
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return "";
  }
}

function resolveSpec(spec, repoRoot) {
  if (spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("file://")) {
    const rel = spec.startsWith("file://") ? new URL(spec).pathname : spec;
    const base = path.resolve(repoRoot, rel);
    for (const probe of RELATIVE_PROBES) {
      const candidate = `${base}${probe}`;
      try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
      } catch {}
    }
    return null;
  }
  return path.join(repoRoot, "node_modules", spec, "package.json");
}

// Returns { kind: "peer", pid, port } | { kind: "module-not-found", spec, exists } | null.
function classifyTail(buf) {
  const tail = tailOf(buf);
  const peerMatch = tail.match(PEER_RE);
  if (peerMatch) {
    const port = Number(peerMatch[1]);
    const pid = Number(peerMatch[2]);
    if (Number.isFinite(pid) && Number.isFinite(port) && pid > 0) return { kind: "peer", pid, port };
  }
  const misses = [...tail.matchAll(MISSING_RE)];
  if (misses.length) {
    const spec = misses[misses.length - 1][1];
    const resolved = resolveSpec(spec, ROOT);
    let exists = false;
    if (resolved) {
      try { exists = fs.existsSync(resolved); } catch {}
    }
    return { kind: "module-not-found", spec, exists };
  }
  return null;
}

function killPid(pid) {
  try { process.kill(pid, "SIGTERM"); } catch {}
}

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
      env: {
        ELECTRON_RUN_AS_NODE: "1",
        NODE_ENV: "production",
        PORT: String(port),
        HOSTNAME: "127.0.0.1",
        // Weft's own skills (plugin/ in the repo), shipped next to the server; see lib/skills.ts.
        WEFT_PLUGIN_DIR: path.join(process.resourcesPath, "plugin"),
        // The splash's art, inside app.asar; the browser pane (Electron) reads file:// from there. See lib/show.ts.
        WEFT_ASSETS_DIR: path.join(__dirname, "assets"),
      },
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
// repeated crashes; onMark("port") times freeing the port for the startup timer. Returns { url, stop, restart, logPath }.
async function startServer({ preferredPort, env, onStatus, onFatal, onMark }) {
  // From source the board always lives on one port: evict any stale server (and its build folder)
  // instead of wandering to another port, so two servers never share `.next`.
  if (!app.isPackaged) {
    freePort(preferredPort, process.env.THREADBOARD_PROD ? undefined : process.env.THREADBOARD_DIST || ".next");
  }
  const port = await pickPort(preferredPort);
  onMark?.("port");
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
      // Inspect the child's recent output for a recoverable cause: a peer dev server (Next 16.4's
      // project-wide guard) or a stale "Module not found" for a path that exists on disk. Both
      // should not count toward the 3-in-2-min crash budget.
      const classified = classifyTail(readTail(logPath));
      if (classified?.kind === "peer") {
        log.write(`--- weft: killing peer dev server pid ${classified.pid} (port ${classified.port})\n`);
        killPid(classified.pid);
        crashes = [];
        onStatus?.("Restarting…");
        setTimeout(launch, RECOVER_GRACE_MS);
        return;
      }
      if (classified?.kind === "module-not-found" && classified.exists) {
        const dist = process.env.THREADBOARD_DIST || ".next";
        const distPath = path.join(ROOT, dist);
        log.write(`--- weft: stale module resolution for "${classified.spec}"; removing ${dist} and retrying\n`);
        try { fs.rmSync(distPath, { recursive: true, force: true }); } catch {}
        crashes = [];
        onStatus?.("Restarting…");
        setTimeout(launch, RECOVER_GRACE_MS);
        return;
      }
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
    port,
    logPath,
    // The supervised process; changes when it restarts. In dev this is `next dev`'s launcher.
    get pid() {
      return proc?.pid;
    },
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
