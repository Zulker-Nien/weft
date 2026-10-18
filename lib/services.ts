import path from "node:path";
import type { ServiceEntry, ServiceKind, ServiceProc } from "./types";

// The process side of the Services drawer: one `ps` of the whole machine, cut down to the tree under
// Weft (Electron main, or the Next server when there's no Electron above it), and split into services:
// each thread CLI and dev server Weft started with everything under it, each terminal shell, and any
// other command Weft's server ran. Pure; lib/services-snapshot.ts runs ps and supplies the context.

export interface Proc extends ServiceProc {
  pgid: number;
  // Seconds since it started.
  elapsed: number;
}

// What the server knows about a pid it spawned itself.
export interface Known {
  kind: "cli" | "dev";
  label: string;
  cardId?: string;
  title?: string;
  cwd?: string;
  url?: string;
}

export interface Context {
  // The Next server's own pid.
  self: number;
  known: Map<number, Known>;
  // By the CLI's session id, for a CLI whose pid the server didn't keep (one started before an update).
  bySession?: Map<string, Known>;
  now: number;
}

// `claude … --resume=<id>` / `--session-id <id>` → the id.
export function sessionArg(command: string): string | undefined {
  return /--(?:session-id|resume)[= ](\S+)/.exec(command)?.[1];
}

// The snapshot's own `ps`, which is always there and never interesting.
function isOwnPs(proc: Proc, self: number) {
  return proc.ppid === self && /^(\/bin\/)?ps\s/.test(proc.command);
}

// `ps -axo pid=,ppid=,pgid=,%cpu=,rss=,etime=,command=` → one row per process.
export function parseProcs(out: string): Proc[] {
  const rows: Proc[] = [];
  for (const line of out.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const [, pid, ppid, pgid, cpu, rss, etime = "", command = ""] = m;
    rows.push({ pid: Number(pid), ppid: Number(ppid), pgid: Number(pgid), cpu: Number(cpu), memKb: Number(rss), elapsed: parseElapsed(etime), command: command.trim() });
  }
  return rows;
}

// ps's etime, "[[dd-]hh:]mm:ss" → seconds.
export function parseElapsed(etime: string): number {
  const [days, clock = ""] = etime.includes("-") ? etime.split("-") : ["0", etime];
  const parts = clock.split(":").map(Number);
  while (parts.length < 3) parts.unshift(0);
  const [h = 0, m = 0, s = 0] = parts;
  const total = Number(days) * 86_400 + h * 3600 + m * 60 + s;
  return Number.isFinite(total) ? total : 0;
}

// Electron and its helpers, the Next server and its workers: Weft itself.
const WEFT_OWN = /Electron|\/Weft\.app\/|Weft Helper|next-server|next\/dist\/|\/\.next\/|crashpad/;

export function isWeftOwn(command: string) {
  return WEFT_OWN.test(command);
}

// The highest ancestor of the server that is still Weft (Electron main in the app, `next dev` alone).
export function findRoot(byPid: Map<number, Proc>, self: number): number {
  let root = self;
  let parent = byPid.get(self)?.ppid;
  while (parent && parent > 1) {
    const proc = byPid.get(parent);
    if (!proc || !isWeftOwn(proc.command)) break;
    root = parent;
    parent = proc.ppid;
  }
  return root;
}

// "/usr/bin/git status --porcelain" → "git status"; "-zsh" → "zsh".
export function shortCommand(command: string) {
  const [exe = "", arg] = command.split(/\s+/);
  const name = path.basename(exe).replace(/^-/, "");
  return arg && !arg.startsWith("-") && !arg.includes("/") ? `${name} ${arg}` : name;
}

const ORDER: Record<ServiceKind, number> = { cli: 0, dev: 1, task: 2, terminal: 3, other: 4, weft: 5 };

export function buildServices(procs: Proc[], ctx: Context): ServiceEntry[] {
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const children = new Map<number, Proc[]>();
  for (const p of procs) children.set(p.ppid, [...(children.get(p.ppid) ?? []), p]);
  const root = findRoot(byPid, ctx.self);
  const services = new Map<string, ServiceEntry>();

  const open = (proc: Proc, owner: ServiceEntry | undefined): ServiceEntry => {
    if (owner && owner.kind !== "weft") return owner;
    const session = sessionArg(proc.command);
    const known = ctx.known.get(proc.pid) ?? (session ? ctx.bySession?.get(session) : undefined);
    const fresh = (id: string, kind: ServiceKind, label: string, extra: Partial<ServiceEntry> = {}): ServiceEntry => {
      const existing = services.get(id);
      if (existing) return existing;
      const entry: ServiceEntry = { id, kind, label, state: "running", cpu: 0, memKb: 0, startedAt: ctx.now - proc.elapsed * 1000, procs: [], ...extra };
      services.set(id, entry);
      return entry;
    };
    if (known) {
      const { kind, label, ...rest } = known;
      return fresh(known.cardId ? `${kind}:${known.cardId}` : `pid:${proc.pid}`, kind, label, rest);
    }
    if (proc.pid === root || isWeftOwn(proc.command)) return fresh("weft", "weft", "Weft");
    if (proc.ppid === root && root !== ctx.self) return fresh(`pid:${proc.pid}`, "terminal", `Terminal · ${shortCommand(proc.command)}`);
    return fresh(`pid:${proc.pid}`, "other", shortCommand(proc.command));
  };

  const visit = (proc: Proc, owner: ServiceEntry | undefined, seen: Set<number>) => {
    if (seen.has(proc.pid) || isOwnPs(proc, ctx.self)) return;
    seen.add(proc.pid);
    const service = open(proc, owner);
    service.procs.push({ pid: proc.pid, ppid: proc.ppid, cpu: proc.cpu, memKb: proc.memKb, command: proc.command });
    service.cpu += proc.cpu;
    service.memKb += proc.memKb;
    for (const child of children.get(proc.pid) ?? []) visit(child, service, seen);
  };
  const top = byPid.get(root);
  if (top) visit(top, undefined, new Set());

  return sortServices([...services.values()].map((s) => ({ ...s, cpu: Math.round(s.cpu * 10) / 10 })));
}

// Threads first, Weft itself last; newest first within a kind, so rows don't jump on each refresh.
export function sortServices(services: ServiceEntry[]): ServiceEntry[] {
  return [...services].sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || b.startedAt - a.startedAt);
}
