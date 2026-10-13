import type { Backend, Card, Effort } from "./types";
import type { HeldModifiers } from "./use-mod-held";

// What the New thread dialog offers and remembers (components/NewCardDialog.tsx draws it).

export const LAST_CWD = "threadboard.cwd";
export const LAST_BACKEND = "threadboard.backend";
const LAST_MODEL = "weft.model";
const LAST_EFFORT = "weft.effort";
// What you were writing, kept if the dialog closes before the thread is created.
export const DRAFT = "weft.newThreadDraft";

export function remembered(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function remember(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {}
}

export const BACKENDS: { id: Backend; label: string }[] = [
  { id: "claude", label: "Claude Code" },
  { id: "puku", label: "puku-cli" },
];

// The Puku gateway serves these three and answers any other id as puku-ai-2.8.
export const MODELS: Record<Backend, { id: string; label: string }[]> = {
  claude: [
    { id: "claude-fable-5-1", label: "Fable 5.1" },
    { id: "claude-opus-5-5", label: "Opus 5.5" },
    { id: "claude-sonnet-5-5", label: "Sonnet 5.5" },
    { id: "claude-haiku-5-5", label: "Haiku 5.5" },
  ],
  puku: [
    { id: "opus-4.8", label: "Opus 4.8" },
    { id: "puku-ai-2.8", label: "Puku AI 2.8" },
    { id: "puku-ai-2.7", label: "Puku AI 2.7" },
  ],
};

// The CLI that serves a model id, or undefined for an id neither serves.
export function backendFor(model: string): Backend | undefined {
  return (Object.keys(MODELS) as Backend[]).find((b) => MODELS[b].some((m) => m.id === model));
}

const DEFAULT_MODEL: Record<Backend, string> = {
  claude: "claude-opus-5-5",
  puku: "opus-4.8",
};

// The last model picked for this CLI, or its default.
export function modelFor(backend: Backend) {
  const saved = remembered(`${LAST_MODEL}.${backend}`);
  return saved !== null && MODELS[backend].some((m) => m.id === saved)
    ? saved
    : DEFAULT_MODEL[backend];
}

// "" leaves it to the model's own default. A new thread uses the last card's choice, High at first.
const DEFAULT_EFFORT: Effort = "high";
export const EFFORTS: { id: Effort | ""; label: string }[] = [
  { id: "", label: "Default effort" },
  { id: "low", label: "Low effort" },
  { id: "medium", label: "Medium effort" },
  { id: "high", label: "High effort" },
  { id: "xhigh", label: "Extra high effort" },
  { id: "max", label: "Max effort" },
];

// What each backend accepts. Puku-cli only takes low/medium/high/max — xhigh crashes it
// (puku-cli exits 1 with "option '--effort' argument 'xhigh' is invalid").
const EFFORT_BY_BACKEND: Record<Backend, Effort[]> = {
  claude: ["low", "medium", "high", "xhigh", "max"],
  puku: ["low", "medium", "high", "max"],
};

// The closest effort a backend accepts. Drops xhigh to high for puku. "" / undefined pass through
// as undefined (use the model's own default). Use this everywhere a card's effort is sent to a
// CLI, not a hard-coded branch.
export function effortFor(backend: Backend, effort: Effort | "" | undefined): Effort | undefined {
  if (!effort) return undefined;
  const allowed = EFFORT_BY_BACKEND[backend];
  if (allowed.includes(effort)) return effort;
  // Closest fall-back by index: xhigh (4) → high (2) for puku.
  const claudeOrder: Effort[] = ["low", "medium", "high", "xhigh", "max"];
  const idx = claudeOrder.indexOf(effort);
  if (idx === -1) return undefined;
  for (let i = idx; i >= 0; i--) {
    const candidate = claudeOrder[i];
    if (candidate && allowed.includes(candidate)) return candidate;
  }
  return undefined;
}

// The last effort picked, High at first. Only the Claude CLI takes one.
export function lastEffort(): Effort | "" {
  const saved = remembered(LAST_EFFORT);
  return EFFORTS.find((e) => e.id === saved)?.id ?? DEFAULT_EFFORT;
}

// Keep the picks of a thread that was just made, for the next one. Effort is kept even when it's "",
// so picking Default effort sticks too.
export function rememberPicks(picks: { cwd: string; backend: Backend; model: string; effort: Effort | "" }) {
  remember(LAST_CWD, picks.cwd);
  remember(LAST_BACKEND, picks.backend);
  remember(`${LAST_MODEL}.${picks.backend}`, picks.model);
  remember(LAST_EFFORT, picks.effort);
}

// Why this prompt can't start yet, if it can't.
export function problemWith(prompt: string): string | null {
  return prompt ? null : "Write a prompt first.";
}

export function errorText(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

// A prompt's first line without its Markdown heading marks, for naming the thread it started.
export function headline(prompt: string) {
  return (prompt.split("\n")[0] ?? "").replace(/^#+\s*/, "").slice(0, 60);
}

// The Start button's text and key cap: ⌃ names ⌃↵ (start, stay open), ⌘ names ⌘↵ (start, close).
export function startButton(held: HeldModifiers) {
  if (held.ctrl) return { label: "Start, keep open", key: "⌃↵" };
  if (held.mod) return { label: "Start & close", key: "⌘↵" };
  return { label: "Start now", key: "⌘" };
}

// A model id as the thread header shows it: "Fable 5.1" for one of ours, otherwise the id without "claude-" or a "[1m]" suffix.
export function modelLabel(id: string) {
  const bare = id.replace(/\[[^\]]*\]$/, "");
  return Object.values(MODELS).flat().find((m) => m.id === bare)?.label ?? bare.replace(/^claude-/, "");
}

// The model and effort a card runs on: its own picks, else what its CLI's init reported (lib/cli-defaults.ts).
export function runningOn(card: Pick<Card, "model" | "effort" | "stats">): { model?: string; effort?: Effort } {
  return { model: card.model ?? card.stats?.runsOn?.model, effort: card.effort ?? card.stats?.runsOn?.effort };
}
