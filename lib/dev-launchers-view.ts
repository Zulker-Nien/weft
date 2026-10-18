import { folderName } from "./format";
import type { DevLauncher, LauncherCommand, ServiceState } from "./types";

// How the Services drawer's Dev servers section (components/DevLaunchers.tsx) reads GET /api/services' launchers.

const LIVE = new Set<ServiceState>(["running", "starting"]);

// The board's project's folders (a folder inside it counts); every folder when no project is picked.
export function filterLaunchers(launchers: readonly DevLauncher[], project: string | null): DevLauncher[] {
  if (!project) return [...launchers];
  return launchers.filter((l) => l.cwd === project || l.cwd.startsWith(`${project}/`));
}

// The command a folder's row shows: the one the user picked, else one Weft runs, else the best (the first).
export function pickCommand(l: DevLauncher, picked?: string): LauncherCommand {
  const first = l.commands[0] as LauncherCommand;
  return l.commands.find((c) => c.command === picked) ?? l.commands.find((c) => c.run && LIVE.has(c.run.state)) ?? first;
}

// "23:41", in the Mac's own clock.
export function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

export interface LauncherRow {
  key: string;
  folder: string;
  command: string;
  label: string;
  // stopped when nothing of Weft's runs it.
  state: ServiceState;
  live: boolean;
  // Unset on Weft's own folder, which this board runs from: it is never started or stopped here.
  action?: "Start" | "Restart";
  // Stop beside Restart while Weft runs it.
  canStop: boolean;
  // The run's Services row ("dev:<key>"), which Stop ends.
  runId?: string;
  // Weft's own folder: its url opens outside the pane.
  self?: boolean;
  // The card that started it, which its name opens.
  owner?: { cardId: string; title: string };
  // "Restarted 23:41 · 2× · running", "Started 23:40 · starting", "Failed 23:39", or what already answers.
  status?: string;
  url?: string;
}

function status(c: LauncherCommand): string | undefined {
  const run = c.run;
  if (!run) return c.answering && c.url ? `Something else already answers on ${c.url.replace(/^https?:\/\//, "")}` : undefined;
  if (run.state === "failed") return `Failed after starting ${clock(run.startedAt)}`;
  if (run.state === "stopped") return `Stopped · last started ${clock(run.startedAt)}`;
  const verb = run.restarts ? `Restarted ${clock(run.startedAt)}${run.restarts > 1 ? ` · ${run.restarts}×` : ""}` : `Started ${clock(run.startedAt)}`;
  return `${verb} · ${run.state}`;
}

// Weft's own folder: the board itself, always running, nothing to start or stop; its url is the board's
// address, which opens in the system browser (the pane refuses Weft's own server).
function selfRow(base: Pick<LauncherRow, "key" | "folder" | "command" | "label">, url?: string): LauncherRow {
  return { ...base, state: "running", live: true, canStop: false, status: "Weft itself: this board runs from here", self: true, ...(url && { url }) };
}

export function launcherRow(cwd: string, c: LauncherCommand, self = false, selfUrl?: string): LauncherRow {
  const base = { key: `${cwd}\n${c.command}`, folder: folderName(cwd), command: c.command, label: c.label };
  if (self) return selfRow(base, selfUrl);
  const run = c.run;
  const state = run?.state ?? "stopped";
  const live = LIVE.has(state);
  const line = status(c);
  return {
    ...base,
    state,
    live,
    action: live ? "Restart" : "Start",
    canStop: !!run && live,
    ...(run && { runId: run.id }),
    ...(run?.cardId && { owner: { cardId: run.cardId, title: run.title ?? "its thread" } }),
    ...(line && { status: line }),
    ...(c.url && { url: c.url }),
  };
}

// The chip a row shows for a moment after its button: what the click did.
export function launchedWord(result: "started" | "restarted"): string {
  return result === "restarted" ? "Restarted" : "Started";
}
