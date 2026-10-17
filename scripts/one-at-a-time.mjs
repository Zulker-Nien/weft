// Runs a command while holding a machine-wide lock, so parallel cards take turns at `pnpm typecheck` and
// `pnpm lint` (and the pre-commit hook's tsc) instead of all checking the whole repo at once. Five tsc runs
// side by side each take five times as long and pin every core; one after another they share the
// incremental cache. Usage: node scripts/one-at-a-time.mjs <name> "<command>" [args...]
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const POLL_MS = 500;

export function lockPath(name, dir = os.tmpdir()) {
  return path.join(dir, `weft-${name.replace(/[^\w.-]/g, "_")}.lock`);
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}

// Takes the lock if it's free or its holder is gone; false while a live process holds it.
export function tryLock(file, pid = process.pid) {
  try {
    fs.writeFileSync(file, String(pid), { flag: "wx" });
    return true;
  } catch (err) {
    if (err.code !== "EEXIST") throw err;
  }
  const holder = Number(fs.readFileSync(file, "utf8"));
  if (holder && alive(holder)) return false;
  fs.rmSync(file, { force: true });
  return tryLock(file, pid);
}

export function unlock(file, pid = process.pid) {
  try {
    if (Number(fs.readFileSync(file, "utf8")) === pid) fs.rmSync(file, { force: true });
  } catch {
    // Already gone.
  }
}

export async function waitForLock(file, { poll = POLL_MS, onWait = (_pid) => {} } = {}) {
  let told = false;
  while (!tryLock(file)) {
    if (!told) onWait(Number(fs.readFileSync(file, "utf8")));
    told = true;
    await new Promise((resolve) => setTimeout(resolve, poll));
  }
}

async function main([name, command, ...args]) {
  if (!name || !command) {
    console.error('usage: one-at-a-time.mjs <name> "<command>" [args...]');
    return 2;
  }
  const once = process.env.TSC_ONCE_ACTIVE ? null : onPath("tsc-once");
  if (once) return delegate(once, name, [command, ...args].join(" "));
  const file = lockPath(name);
  await waitForLock(file, {
    onWait: (pid) => console.error(`${name}: another ${name} is running (pid ${pid}); waiting for it to finish…`),
  });
  const release = () => unlock(file);
  process.on("exit", release);
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(signal, () => {
      release();
      process.exit(130);
    });
  }
  const child = spawn([command, ...args].join(" "), { stdio: "inherit", shell: true });
  return new Promise((resolve) => child.on("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0))));
}

// The machine-wide tsc-once (github.com/fotoflo/zprofile bin/tsc-once), when installed, does this lock's job
// for every project on the Mac: one check per project, at most two at once overall, and a caller whose tree
// hasn't changed since the last check started gets that check's result instead of running it again.
export function onPath(bin, dirs = (process.env.PATH ?? "").split(path.delimiter)) {
  for (const dir of dirs) {
    const file = path.join(dir, bin);
    try {
      fs.accessSync(file, fs.constants.X_OK);
      return file;
    } catch {
      // Not here.
    }
  }
  return null;
}

function delegate(once, name, command) {
  // Keyed by this repo, so the pre-commit hook's check (run from a temp copy) takes turns with `pnpm typecheck`.
  const key = `${fs.realpathSync(path.resolve(import.meta.dirname, ".."))}::${name}`;
  const child = spawn(once, ["--name", name, "--key", key, "--", command], { stdio: "inherit" });
  return new Promise((resolve) => child.on("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0))));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = await main(process.argv.slice(2));
}
