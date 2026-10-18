import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

// A thread's subagents and background commands, as the CLI reports them (task_started, task_progress,
// task_updated, task_notification and the background_tasks_changed level), kept on the card so the
// thread panel can show what's running and the thread can be told what it lost when its CLI ended.
// Pure: lib/task-ledger.ts reads and writes the card.

// "ended": it left the CLI's live set without a final word, so how it went is unknown. "lost": its CLI
// process ended (a Weft restart, the idle close) while it ran, so it was cut off and won't report back.
export type TaskStatus = "running" | "completed" | "failed" | "stopped" | "ended" | "lost";
export type TaskKind = "agent" | "shell" | "monitor" | "workflow" | "other";

export interface CardTask {
  id: string;
  // The Agent or Bash tool call that started it.
  toolUseId?: string;
  kind: TaskKind;
  description: string;
  // An agent's type ("Explore", "general-purpose").
  subagentType?: string;
  background?: boolean;
  status: TaskStatus;
  startedAt: number;
  endedAt?: number;
  // The latest progress line while it runs, then its final summary or error.
  summary?: string;
  outputFile?: string;
  tokens?: number;
  toolUses?: number;
  lastTool?: string;
  // A lost task is put in a note on the thread's next message once (taskNote); this marks it sent.
  told?: boolean;
}

type System = Extract<SDKMessage, { type: "system" }>;
type Of<S extends System["subtype"]> = Extract<System, { subtype: S }>;

// Ended tasks kept on the card, newest first; running ones are always kept.
export const KEEP_ENDED = 20;
// A task that has said "running" this long without a word is ignored by isLive, so a missed final
// event can't keep its CLI open forever.
export const STALE_MS = 6 * 60 * 60_000;

export function taskKind(type: string | undefined): TaskKind {
  if (!type) return "other";
  if (type.includes("agent")) return "agent";
  if (type.includes("bash") || type.includes("shell")) return "shell";
  if (type.includes("monitor")) return "monitor";
  if (type.includes("workflow")) return "workflow";
  return "other";
}

const ENDED: Record<string, TaskStatus> = { completed: "completed", failed: "failed", killed: "stopped" };

// The ledger after one CLI message, or undefined when the message isn't about a task or changes nothing.
export function applyTaskMessage(tasks: readonly CardTask[] = [], msg: SDKMessage, now: number): CardTask[] | undefined {
  if (msg.type !== "system") return undefined;
  switch (msg.subtype) {
    case "task_started":
      return started(tasks, msg, now);
    case "task_progress":
      return patch(tasks, msg.task_id, progressPatch(msg), () => fromProgress(msg, now));
    case "task_updated":
      return patch(tasks, msg.task_id, updatedPatch(msg));
    case "task_notification":
      // One whose start this ledger never saw is a foreground command from before it listened: left out.
      return patch(tasks, msg.task_id, notifiedPatch(msg, now, tasks.find((t) => t.id === msg.task_id)));
    case "background_tasks_changed":
      return liveSet(tasks, msg, now);
    default:
      return undefined;
  }
}

function started(tasks: readonly CardTask[], msg: Of<"task_started">, now: number): CardTask[] | undefined {
  if (msg.ambient || msg.skip_transcript) return undefined;
  const task: CardTask = {
    id: msg.task_id,
    ...(msg.tool_use_id && { toolUseId: msg.tool_use_id }),
    kind: taskKind(msg.task_type),
    description: msg.workflow_name ?? msg.description,
    ...(msg.subagent_type && { subagentType: msg.subagent_type }),
    ...(msg.is_backgrounded !== undefined && { background: msg.is_backgrounded }),
    status: "running",
    startedAt: now,
  };
  return trim([task, ...tasks.filter((t) => t.id !== msg.task_id)]);
}

function progressPatch(msg: Of<"task_progress">): Partial<CardTask> {
  return {
    tokens: msg.usage.total_tokens,
    toolUses: msg.usage.tool_uses,
    ...(msg.last_tool_name && { lastTool: msg.last_tool_name }),
    ...(msg.summary && { summary: msg.summary }),
  };
}

// A task this ledger missed the start of (it began before Weft was listening), from its progress.
function fromProgress(msg: Of<"task_progress">, now: number): CardTask {
  return {
    id: msg.task_id,
    ...(msg.tool_use_id && { toolUseId: msg.tool_use_id }),
    kind: msg.subagent_type ? "agent" : "other",
    description: msg.description,
    ...(msg.subagent_type && { subagentType: msg.subagent_type }),
    status: "running",
    startedAt: now - msg.usage.duration_ms,
  };
}

function updatedPatch(msg: Of<"task_updated">): Partial<CardTask> {
  const { status, description, end_time, error, is_backgrounded } = msg.patch;
  const ended = status ? ENDED[status] : undefined;
  return {
    ...(status && { status: ended ?? "running" }),
    ...(description && { description }),
    ...(end_time && { endedAt: end_time }),
    ...(error && { summary: error }),
    ...(is_backgrounded !== undefined && { background: is_backgrounded }),
  };
}

// A resumed CLI reports tasks a previous process left behind as stopped: with reason "worker_restart",
// or (no structured field) a summary like "Orphaned by a previous Claude Code process exit".
const ORPHANED_RE = /\borphaned by a previous\b/i;
function isOrphaned(msg: Of<"task_notification">): boolean {
  return msg.reason === "worker_restart" || (msg.status === "stopped" && ORPHANED_RE.test(msg.summary));
}

// An orphaned task is lost, so taskNote tells the thread; one Weft already marked lost keeps its
// cut-off time and its told mark, so it isn't told twice.
function notifiedPatch(msg: Of<"task_notification">, now: number, current: CardTask | undefined): Partial<CardTask> {
  const orphaned = isOrphaned(msg);
  const known = orphaned && current?.status === "lost";
  return {
    status: orphaned ? "lost" : msg.status,
    ...(orphaned && !known && { told: false }),
    endedAt: known && current.endedAt ? current.endedAt : now,
    ...(msg.summary && { summary: msg.summary }),
    ...(msg.output_file && { outputFile: msg.output_file }),
    ...(msg.usage && { tokens: msg.usage.total_tokens, toolUses: msg.usage.tool_uses }),
  };
}

// The level: every live background task. A running background task missing from it ended without a
// final event this ledger saw; one in it this ledger doesn't know is added.
function liveSet(tasks: readonly CardTask[], msg: Of<"background_tasks_changed">, now: number): CardTask[] | undefined {
  const live = new Map(msg.tasks.filter((t) => !t.ambient).map((t) => [t.task_id, t]));
  const next = tasks.map((t) => {
    if (live.has(t.id)) return t.background ? t : { ...t, background: true };
    if (t.status !== "running" || !t.background) return t;
    return { ...t, status: "ended" as const, endedAt: now };
  });
  const known = new Set(tasks.map((t) => t.id));
  const added: CardTask[] = [...live.values()]
    .filter((t) => !known.has(t.task_id))
    .map((t) => ({
      id: t.task_id,
      kind: taskKind(t.task_type),
      description: t.description,
      ...(t.subagent_type && { subagentType: t.subagent_type }),
      background: true,
      status: "running",
      startedAt: now,
    }));
  const changed = next.some((t, i) => t !== tasks[i]);
  return changed || added.length ? trim([...added, ...next]) : undefined;
}

// Merges a patch into the task with this id; an unknown id is made by `create` (or ignored without it).
function patch(tasks: readonly CardTask[], id: string, change: Partial<CardTask>, create?: () => CardTask): CardTask[] | undefined {
  const current = tasks.find((t) => t.id === id);
  if (current) return tasks.map((t) => (t === current ? { ...t, ...change } : t));
  return create ? trim([{ ...create(), ...change }, ...tasks]) : undefined;
}

// What the thread panel and the card track: subagents, and anything running in the background. The CLI
// registers every foreground Bash call as a task too; those already show as tool rows.
export function tracked(t: CardTask): boolean {
  return t.kind === "agent" || t.background === true;
}

// Every running task, plus the newest KEEP_ENDED tracked ones that ended.
function trim(tasks: CardTask[]): CardTask[] {
  let ended = 0;
  return tasks.filter((t) => t.status === "running" || (tracked(t) && ++ended <= KEEP_ENDED));
}

// The CLI process is gone, and its tasks with it (they run in its process group): mark the running ones
// lost. Undefined when none were running.
export function orphanTasks(tasks: readonly CardTask[] = [], now: number): CardTask[] | undefined {
  if (!tasks.some((t) => t.status === "running")) return undefined;
  return tasks.map((t) => (t.status === "running" ? { ...t, status: "lost" as const, endedAt: now, told: false } : t));
}

// The tracked tasks still running.
export function runningTasks(tasks: readonly CardTask[] = []): CardTask[] {
  return tasks.filter((t) => t.status === "running" && tracked(t));
}

// A shell task whose description looks like a dev server, so the dev-server drawer can list it
// alongside Weft-started ones. Tasks that match go in the drawer, not the task strip.
const DEV_SERVER_RE = /\b(dev ?server|npm run dev|pnpm (run )?dev|yarn dev|bun (run )?dev|next dev|vite|astro dev|remix dev|nuxt dev|localhost:\d+|on port \d+)\b/i;
export function isDevServerTask(t: CardTask): boolean {
  return t.kind === "shell" && DEV_SERVER_RE.test(t.description);
}

// Whether a background task is still running (and not gone quiet past STALE_MS), so its CLI must stay open.
export function hasLiveBackground(tasks: readonly CardTask[] = [], now: number): boolean {
  return tasks.some((t) => t.status === "running" && t.background && now - t.startedAt < STALE_MS);
}

function clock(at: number): string {
  return new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

// What the thread is told with its next message about tasks its CLI lost, and the ledger with them
// marked told; undefined when there's nothing new to tell. A fresh CLI that resumed the session has no
// record of them and would otherwise wait for reports that never come.
export function taskNote(tasks: readonly CardTask[] = []): { note: string; tasks: CardTask[] } | undefined {
  const lost = tasks.filter((t) => t.status === "lost" && !t.told && tracked(t));
  if (!lost.length) return undefined;
  const lines = lost.map((t) => {
    const what = t.subagentType ? `${t.kind}, ${t.subagentType}` : t.kind;
    const since = `started ${clock(t.startedAt)}${t.endedAt ? `, cut off ${clock(t.endedAt)}` : ""}`;
    const out = t.outputFile ? `; partial output in ${t.outputFile}` : "";
    return `- "${t.description}" (${what}, ${since}${out})`;
  });
  const note = `[Weft: ${lost.length === 1 ? "a background task" : `${lost.length} background tasks`} of this thread ended with its CLI process and won't report back. Don't wait on ${lost.length === 1 ? "it" : "them"}: check what ${lost.length === 1 ? "it" : "they"} wrote, or run ${lost.length === 1 ? "it" : "them"} again.\n${lines.join("\n")}]\n\n`;
  return { note, tasks: tasks.map((t) => (lost.includes(t) ? { ...t, told: true } : t)) };
}
