import { isDevServerTask, runningTasks, tracked, type CardTask, type TaskStatus } from "./tasks";

// How the thread panel's subagent strip (components/TaskStrip.tsx) and the card's count read a card's tasks.

// An ended task stays in the strip this long after it ends, so a finished fan-out is still visible when you look.
export const RECENT_MS = 15 * 60_000;

export const STATUS_LABEL: Record<TaskStatus, string> = {
  running: "running",
  completed: "done",
  failed: "failed",
  stopped: "stopped",
  ended: "ended",
  lost: "cut off",
};

export const STATUS_TONE: Record<TaskStatus, string> = {
  running: "text-accent",
  completed: "text-ok",
  failed: "text-danger",
  stopped: "text-faint",
  ended: "text-muted",
  lost: "text-warn",
};

// "42s", "6m", "1h 20m".
export function taskDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}`;
}

export interface TaskRow {
  id: string;
  description: string;
  status: TaskStatus;
  label: string;
  tone: string;
  // "agent · Explore · bg", the kind and how it runs.
  kind: string;
  // "6m · 14 tools · 32k tok": elapsed while running, how long it took after.
  meta: string;
  // The latest progress line or the final summary, else the tool it's on.
  detail?: string;
  outputFile?: string;
}

function tokens(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k tok` : `${n} tok`;
}

function row(t: CardTask, now: number): TaskRow {
  const meta = [taskDuration((t.endedAt ?? now) - t.startedAt)];
  if (t.toolUses) meta.push(`${t.toolUses} tool${t.toolUses === 1 ? "" : "s"}`);
  if (t.tokens) meta.push(tokens(t.tokens));
  const kind = [t.kind, t.subagentType, t.background ? "bg" : undefined].filter(Boolean).join(" · ");
  // A shell task's summary can repeat its description, and a finished agent's is the CLI's "report was delivered" line.
  const summary = t.summary === t.description || (t.kind === "agent" && t.status === "completed") ? undefined : t.summary;
  const detail = summary ?? (t.status === "running" && t.lastTool ? `on ${t.lastTool}` : undefined);
  return {
    id: t.id,
    description: t.description,
    status: t.status,
    label: STATUS_LABEL[t.status],
    tone: STATUS_TONE[t.status],
    kind,
    meta: meta.join(" · "),
    ...(detail && { detail }),
    ...(t.outputFile && { outputFile: t.outputFile }),
  };
}

export interface TaskStripView {
  running: number;
  // "3 subagents running · 2 done · 1 cut off"
  headline: string;
  rows: TaskRow[];
  // Shown under the rows while a cut-off task hasn't been named to the thread yet.
  hint?: string;
}

export const CUT_OFF_HINT = "Send a message and the thread is told what was cut off, so it can run it again.";

// The strip: running tasks first, then the ones that ended in the last RECENT_MS (or were cut off and
// not yet seen by the thread); undefined when there's nothing to show. Running dev-server tasks go in
// the dev-server drawer, not here; ended ones still appear so a finished fan-out stays visible.
export function taskStripView(tasks: readonly CardTask[] = [], now: number): TaskStripView | undefined {
  const shown = tasks.filter((t) => tracked(t) && (t.status !== "running" || !isDevServerTask(t)) && (t.status === "running" || (t.status === "lost" && !t.told) || now - (t.endedAt ?? now) < RECENT_MS));
  if (!shown.length) return undefined;
  const order = (t: CardTask) => (t.status === "running" ? 0 : 1);
  const sorted = [...shown].sort((a, b) => order(a) - order(b) || b.startedAt - a.startedAt);
  const counts = new Map<string, number>();
  for (const t of sorted) counts.set(STATUS_LABEL[t.status], (counts.get(STATUS_LABEL[t.status]) ?? 0) + 1);
  const running = counts.get("running") ?? 0;
  const noun = nounFor(shown);
  const parts = [...counts].map(([label, n], i) => (i === 0 && label === "running" ? `${n} ${noun(n)} running` : `${n} ${label}`));
  const headline = running ? parts.join(" · ") : `${shown.length} ${noun(shown.length)}: ${parts.join(" · ")}`;
  const untold = shown.some((t) => t.status === "lost" && !t.told);
  return { running, headline, rows: sorted.map((t) => row(t, now)), ...(untold && { hint: CUT_OFF_HINT }) };
}

// "subagent(s)" when they're all agents, else "task(s)" (background commands, monitors).
function nounFor(tasks: readonly CardTask[]): (n: number) => string {
  const word = tasks.every((t) => t.kind === "agent") ? "subagent" : "task";
  return (n) => (n === 1 ? word : `${word}s`);
}

// The card's badge: how many are running, and its tooltip naming them. Dev-server tasks live in
// the dev-server drawer, not the badge.
export function runningBadge(tasks: readonly CardTask[] = []): { count: number; title: string } | undefined {
  const running = runningTasks(tasks).filter((t) => !isDevServerTask(t));
  if (!running.length) return undefined;
  return { count: running.length, title: `${running.length} ${nounFor(running)(running.length)} running: ${running.map((t) => t.description).join(", ")}` };
}
