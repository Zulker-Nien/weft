import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { killInFolders } from "./cli-reaper";

// The backstop behind lib/orphan-guard.ts: every few minutes, end the vitest workers whose run died and
// that couldn't end themselves (a test stuck in a synchronous loop never gets to its own check). Only
// workers under PID 1 (their `node (vitest)` parent is gone), older than MIN_AGE_S, in one of Weft's
// project folders: a run another card has going keeps its parent, so it's never touched.

const run = promisify(execFile);

export const REAP_EVERY_MS = 5 * 60_000;
// Every worker of a live run has its parent; this only spares one finishing its last test as the run ends.
export const MIN_AGE_S = 120;

// A vitest pool worker's process title: `node (vitest 3)`. The run's own `node (vitest)` isn't one.
export function isVitestWorker(command: string) {
  return /^node \(vitest \d+\)/.test(command.trim());
}

// ps's etime, `[[dd-]hh:]mm:ss`, in seconds.
export function etimeSeconds(etime: string) {
  const [days, clock = ""] = etime.includes("-") ? etime.split("-") : ["0", etime];
  const parts = clock.split(":").map(Number);
  while (parts.length < 3) parts.unshift(0);
  const [h = 0, m = 0, s = 0] = parts;
  return Number(days) * 86_400 + h * 3_600 + m * 60 + s;
}

export interface AgedProc {
  pid: number;
  ppid: number;
  age: number;
  command: string;
}

// `ps -axo pid=,ppid=,etime=,command=` → one row per process.
export function parsePsAged(out: string): AgedProc[] {
  return out
    .split("\n")
    .map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+([\d:-]+)\s+(.*)$/))
    .filter((m): m is RegExpMatchArray => Boolean(m))
    .map(([, pid, ppid, etime = "", command = ""]) => ({ pid: Number(pid), ppid: Number(ppid), age: etimeSeconds(etime), command }));
}

// Kills the orphaned workers and returns their pids.
export async function reapOrphanWorkers(folders: string[], minAge = MIN_AGE_S) {
  if (process.platform === "win32" || folders.length === 0) return [];
  const { stdout } = await run("/bin/ps", ["-axo", "pid=,ppid=,etime=,command="]);
  const orphans = parsePsAged(stdout).filter((p) => p.ppid === 1 && p.age >= minAge && isVitestWorker(p.command));
  if (orphans.length === 0) return [];
  const strays = await killInFolders(orphans.map((p) => p.pid), folders);
  if (strays.length) console.log(`[weft] ended ${strays.length} orphaned vitest worker(s): ${strays.join(", ")}`);
  return strays;
}

const g = globalThis as unknown as { __weftWorkerReaper?: ReturnType<typeof setInterval> };

// Once per server: reap now and every REAP_EVERY_MS, over the folders `folders()` gives at the time.
export function startWorkerReaper(folders: () => string[], every = REAP_EVERY_MS) {
  if (g.__weftWorkerReaper) return false;
  const tick = () => {
    reapOrphanWorkers(folders()).catch((err: unknown) => console.error("[weft] orphaned worker check failed:", err));
  };
  tick();
  g.__weftWorkerReaper = setInterval(tick, every);
  g.__weftWorkerReaper.unref();
  return true;
}

export function stopWorkerReaper() {
  clearInterval(g.__weftWorkerReaper);
  delete g.__weftWorkerReaper;
}
