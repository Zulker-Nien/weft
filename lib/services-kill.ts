import { KILL_GRACE_MS } from "./cli-process";
import { stopDev } from "./devserver";
import { endSession } from "./runner";
import { listServices } from "./services-snapshot";
import { stopTask } from "./task-stop";
import type { ServiceEntry } from "./types";

// The Services drawer's ✕: end a service, or one process in it. A thread's CLI closes through its
// session (the card sees it close, like keep-alive running out), a Weft dev server through its run, a
// thread's own dev server through its task; anything else gets SIGTERM, then SIGKILL after the grace.
// Weft's own processes are refused: ending the server or Electron would cut every thread off.

export class ServiceRefused extends Error {}

// SIGTERM now; SIGKILL whatever is still there after the grace. Children first, so a wrapper can't respawn them.
export function terminate(pids: number[]) {
  const order = [...pids].reverse();
  const signal = (pid: number, sig: NodeJS.Signals) => {
    try {
      process.kill(pid, sig);
      return true;
    } catch {
      return false;
    }
  };
  const alive = order.filter((pid) => signal(pid, "SIGTERM"));
  if (!alive.length) return;
  setTimeout(() => {
    for (const pid of alive) signal(pid, "SIGKILL");
  }, KILL_GRACE_MS).unref();
}

async function end(service: ServiceEntry) {
  if (service.kind === "weft") throw new ServiceRefused("That's Weft itself: quit Weft to end it.");
  if (service.kind === "cli" && service.cardId) await endSession(service.cardId);
  else if (service.kind === "dev" && service.cardId) stopDev(service.cardId);
  else if (service.kind === "task" && service.cardId && service.taskId) await stopTask(service.cardId, service.taskId);
  else terminate(service.procs.map((p) => p.pid));
}

export async function killService(id: string) {
  const service = (await listServices()).find((s) => s.id === id);
  if (service) await end(service);
}

export async function killProc(pid: number) {
  const service = (await listServices()).find((s) => s.procs.some((p) => p.pid === pid));
  if (!service) throw new ServiceRefused(`Process ${pid} isn't one Weft started.`);
  // The process that leads a service ends the whole service, the way its own ✕ would.
  if (service.procs[0]?.pid === pid) return end(service);
  if (service.kind === "weft") throw new ServiceRefused("That's part of Weft itself: quit Weft to end it.");
  terminate([pid]);
}
