// Ends a vitest worker whose parent run is gone. Vitest's forks pool (tinypool) never watches its
// parent: an idle worker exits once the IPC channel closes, but one mid-test keeps going under PID 1,
// and a test with a live timer or a loop keeps it going for good. A thread's Bash command killed or
// timed out mid-run (the CLI ends vitest's main process, not its workers) left twelve of them burning
// CPU on 2026-10-17 until the Mac hung. Loaded by test/orphan-guard-setup.ts in every test file.

// How often the worker checks its parent is still the one it started with.
export const WATCH_MS = 2_000;

export interface GuardedProcess {
  ppid: number;
  pid: number;
  connected?: boolean;
  on(event: "disconnect", listener: () => void): unknown;
  kill(pid: number, signal: NodeJS.Signals): unknown;
}

const FLAG = "__weftOrphanGuard";

// SIGKILL, not process.exit: vitest swaps process.exit out while a test runs, and a test's own SIGTERM
// handler mustn't keep an orphan alive.
function end(proc: GuardedProcess) {
  proc.kill(proc.pid, "SIGKILL");
}

// Watches once per process (setup files run per test file). Returns false when there's nothing to
// watch: not a forked worker, or already watching.
export function guardOrphan(proc: GuardedProcess = process, every = WATCH_MS): boolean {
  const flags = proc as unknown as Record<string, unknown>;
  if (flags[FLAG] || proc.connected === undefined) return false;
  flags[FLAG] = true;
  const parent = proc.ppid;
  // The channel closing is the first sign; the ppid check catches a parent that died without it firing.
  proc.on("disconnect", () => end(proc));
  setInterval(() => {
    if (proc.ppid !== parent || proc.connected === false) end(proc);
  }, every).unref();
  return true;
}
