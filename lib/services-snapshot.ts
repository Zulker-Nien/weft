import { execFile } from "node:child_process";
import os from "node:os";
import { promisify } from "node:util";
import { BACKEND_LABELS, type MachineInfo, type ServiceEntry } from "./types";
import { runs } from "./devserver";
import { listDev } from "./devserver-list";
import { sessions, spares } from "./runner-state";
import { getCard } from "./store";
import { buildServices, parseProcs, sortServices, type Known } from "./services";

// GET /api/services: the process tree under Weft (lib/services.ts), named from what this server
// started (thread CLIs by card, dev servers by run), plus the dev servers that aren't running right
// now (Weft's stopped or failed runs, which can be started again) and the ones threads run in their CLI.

const run = promisify(execFile);

export async function readProcs() {
  const { stdout } = await run("/bin/ps", ["-axo", "pid=,ppid=,pgid=,%cpu=,rss=,etime=,command="], { maxBuffer: 16 * 1024 * 1024 });
  return parseProcs(stdout);
}

// A thread's CLI, by its pid and by its session ids (a CLI started before an update is found by the id in its command line).
function addSessions(known: Map<number, Known>, bySession: Map<string, Known>) {
  for (const [cardId, session] of sessions) {
    const title = getCard(cardId)?.title;
    const entry: Known = { kind: "cli", label: BACKEND_LABELS[session.spec.backend], cardId, cwd: session.spec.cwd, ...(title && { title }) };
    if (session.process?.pid) known.set(session.process.pid, entry);
    for (const id of [session.sessionId, session.spec.sessionId]) if (id) bySession.set(id, entry);
  }
}

function addSpares(known: Map<number, Known>) {
  for (const session of spares.values()) {
    const pid = session.process?.pid;
    if (pid) known.set(pid, { kind: "cli", label: BACKEND_LABELS[session.spec.backend], title: "Warm spare", cwd: session.spec.cwd });
  }
}

function addDevRuns(known: Map<number, Known>) {
  for (const [cardId, r] of runs) {
    const pid = r.child.pid;
    if (!pid || r.exited) continue;
    known.set(pid, { kind: "dev", label: r.command, cardId, cwd: r.cwd, ...(r.title && { title: r.title }), ...(r.url && { url: r.url }) });
  }
}

// The Mac the numbers are out of: its cores (100% CPU is one) and its RAM.
export function machineInfo(): MachineInfo {
  return { cores: os.cpus().length, memKb: Math.round(os.totalmem() / 1024) };
}

// Every pid this server spawned on purpose, with the card it belongs to; thread CLIs also by session id.
export function knownPids(): { known: Map<number, Known>; bySession: Map<string, Known> } {
  const known = new Map<number, Known>();
  const bySession = new Map<string, Known>();
  addSessions(known, bySession);
  addSpares(known);
  addDevRuns(known);
  return { known, bySession };
}

export async function listServices(): Promise<ServiceEntry[]> {
  const now = Date.now();
  const [procs, dev] = await Promise.all([readProcs(), listDev()]);
  const services = buildServices(procs, { self: process.pid, ...knownPids(), now });
  const byId = new Map(services.map((s) => [s.id, s]));
  const extra: ServiceEntry[] = [];
  for (const d of dev) {
    if (d.source === "thread") {
      extra.push({ id: `task:${d.cardId}:${d.taskId}`, kind: "task", label: d.command, cardId: d.cardId, cwd: d.cwd, state: d.state, cpu: 0, memKb: 0, startedAt: d.startedAt, procs: [], ...(d.title && { title: d.title }), ...(d.url && { url: d.url }), ...(d.taskId && { taskId: d.taskId }) });
      continue;
    }
    const live = byId.get(`dev:${d.cardId}`);
    // A live run takes the probe's state ("starting" until its url answers).
    if (live) live.state = d.state;
    else extra.push({ id: `dev:${d.cardId}`, kind: "dev", label: d.command, cardId: d.cardId, cwd: d.cwd, state: d.state, cpu: 0, memKb: 0, startedAt: d.startedAt, procs: [], ...(d.title && { title: d.title }), ...(d.url && { url: d.url }) });
  }
  return sortServices([...services, ...extra]);
}
