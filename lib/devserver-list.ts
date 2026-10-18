import type { DevServerEntry, DevServerStatus } from "./types";
import { devStatus, runs } from "./devserver";
import { isDevServerTask } from "./tasks";
import { listCards } from "./store";

// The Weft-wide list of dev servers (lib/devserver.ts "weft" runs, plus background shell tasks
// threads started the old way). The drawer reads this; mcp__devservers__status replies with it.
export async function listDev(): Promise<DevServerEntry[]> {
  // Probed together: each probe can take up to its 2s timeout.
  const weft = await Promise.all([...runs].map(async ([cardId, run]) => toEntry(cardId, run, await devStatus(cardId, run.url))));
  const thread: DevServerEntry[] = [];
  for (const card of listCards()) {
    if (!card.tasks) continue;
    for (const t of card.tasks) {
      if (t.status !== "running" || !t.background || t.kind !== "shell" || !isDevServerTask(t)) continue;
      thread.push({ cardId: card.id, ...(card.title && { title: card.title }), cwd: card.cwd, command: t.description, ...(parseUrl(t.description) && { url: parseUrl(t.description) }), state: "running", startedAt: t.startedAt, source: "thread", taskId: t.id });
    }
  }
  return [...weft, ...thread].sort((a, b) => b.startedAt - a.startedAt);
}

// Live Weft run with the same cwd and command, so a second card asking for the same server reuses it
// instead of clashing on its port. Undefined when none match.
export function findDev(cwd: string, command: string) {
  for (const [cardId, run] of runs) {
    if (run.exited) continue;
    if (run.command !== command) continue;
    if (run.cwd !== cwd) continue;
    return { cardId, run };
  }
  return undefined;
}

// A run with no url to probe reads "starting" in devStatus for good; here it's running until it exits.
function toEntry(cardId: string, run: WeftRun, status: DevServerStatus): DevServerEntry {
  const state = status.state === "starting" && !run.url ? "running" : status.state;
  return { cardId, ...(run.title && { title: run.title }), cwd: run.cwd, command: run.command, ...(run.url && { url: run.url }), state, startedAt: run.startedAt, source: "weft" };
}

// The fields listDev reads off a Run. lib/devserver.ts's Run interface stays the source of truth.
type WeftRun = { command: string; cwd: string; title?: string; url?: string; exited: boolean; startedAt: number };

// "npm run dev on port 4001" / "vite (localhost:5173)" / "http://localhost:4001/x" -> an http url.
export function parseUrl(description: string): string | undefined {
  const urlMatch = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):\d+\/\S*/i.exec(description);
  if (urlMatch) return urlMatch[0];
  const portMatch = /(?:^|[\s(])(?:localhost:(\d+)|(?:\-\-)?port (\d+)|on port (\d+))(?=\b|\s|$)/i.exec(description);
  if (portMatch) {
    const port = portMatch[1] ?? portMatch[2] ?? portMatch[3];
    if (port) return `http://localhost:${port}`;
  }
  return undefined;
}
