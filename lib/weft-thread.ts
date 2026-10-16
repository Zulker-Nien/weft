import { execFileSync } from "node:child_process";
import path from "node:path";

// Whether a Claude Code hook (.claude/settings.json) runs for one of Weft's own thread CLIs, which have the
// same guards in-process (lib/env.ts guardedCli) and skip it. An env var alone can't say: a thread's Bash
// passes its env on, so a `puku-cli -p` or `claude -p` a thread starts would look like a thread too, and
// run with no guards at all. Weft's CLIs are children of its server (WEFT_SERVER_PID, set by cliEnv), so
// the hook walks up its parents: the server within a few steps, with no shell between them, is a thread.
// Only node: imports here: scripts/import-check-hook.mjs loads this file with Node's type stripping.

export interface Proc {
  ppid: number;
  comm: string;
}

const SHELL = /^-?(sh|bash|zsh|dash|fish)$/;
// The hook's own parent may be the shell the CLI runs hook commands in; past that, a shell means a command.
const MAX_STEPS = 4;

// `ps -A -o pid=,ppid=,comm=` as a pid → process map.
export function parseProcs(out: string): Map<number, Proc> {
  const procs = new Map<number, Proc>();
  for (const line of out.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
    if (m) procs.set(Number(m[1]), { ppid: Number(m[2]), comm: path.basename(String(m[3])) });
  }
  return procs;
}

export function isWeftThread(hookPid: number, serverPid: number, procs: Map<number, Proc>): boolean {
  let pid = procs.get(hookPid)?.ppid;
  for (let step = 0; step < MAX_STEPS && pid; step++) {
    if (pid === serverPid) return true;
    const proc = procs.get(pid);
    if (!proc || (step > 0 && SHELL.test(proc.comm))) return false;
    pid = proc.ppid;
  }
  return false;
}

const ps = () => execFileSync("ps", ["-A", "-o", "pid=,ppid=,comm="], { encoding: "utf8" });

// For this process (the hook), from its env and a fresh `ps`. False whenever that can't be told.
export function hookIsWeftThread(env: Record<string, string | undefined> = process.env, pid = process.pid, list = ps): boolean {
  const serverPid = Number(env.WEFT_SERVER_PID);
  if (!serverPid) return false;
  try {
    return isWeftThread(pid, serverPid, parseProcs(list()));
  } catch {
    return false;
  }
}
