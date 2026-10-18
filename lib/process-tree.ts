import { execFileSync } from "node:child_process";

// The process groups a CLI's own children started. Claude Code runs every Bash command in a group of its
// own, so signalling the CLI's group (lib/cli-process.ts) never reached a `pnpm test` it had running: that
// run lived on after a card was stopped, and its vitest workers ended up under PID 1.

export interface TreeProc {
  pid: number;
  ppid: number;
  pgid: number;
}

// `ps -axo pid=,ppid=,pgid=` → one row per process.
export function parseTree(out: string): TreeProc[] {
  return out
    .split("\n")
    .map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)$/))
    .filter((m): m is RegExpMatchArray => Boolean(m))
    .map(([, pid, ppid, pgid]) => ({ pid: Number(pid), ppid: Number(ppid), pgid: Number(pgid) }));
}

// Every group, other than `pgid` itself, holding a descendant of a process in `pgid`.
export function descendantGroups(pgid: number, procs: TreeProc[]): number[] {
  const children = new Map<number, TreeProc[]>();
  for (const p of procs) children.set(p.ppid, [...(children.get(p.ppid) ?? []), p]);
  const seen = new Set<number>();
  const queue = procs.filter((p) => p.pgid === pgid).map((p) => p.pid);
  const groups = new Set<number>();
  for (let pid = queue.shift(); pid !== undefined; pid = queue.shift()) {
    if (seen.has(pid)) continue;
    seen.add(pid);
    for (const child of children.get(pid) ?? []) {
      if (child.pgid !== pgid) groups.add(child.pgid);
      queue.push(child.pid);
    }
  }
  return [...groups];
}

// Synchronous, so the server's exit hook can use it; [] when ps fails.
export function findDescendantGroups(pgid: number): number[] {
  if (process.platform === "win32") return [];
  try {
    return descendantGroups(pgid, parseTree(execFileSync("/bin/ps", ["-axo", "pid=,ppid=,pgid="], { encoding: "utf8" })));
  } catch {
    return [];
  }
}

// Signals each group, quiet about one that's already gone.
export function signalGroups(groups: number[], signal: NodeJS.Signals) {
  for (const group of groups) {
    try {
      process.kill(-group, signal);
    } catch {
      // Already gone.
    }
  }
}
