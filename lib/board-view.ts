// What the board shows, worked out from the cards: columns, project summaries, sort orders, and what a
// card's move should set off. Pure, so Board.tsx keeps only state and rendering.
import type { ChimeKind } from "./chimes";
import { COLUMNS, type Card, type CardStats, type Column, type Project } from "./types";

export type SortKey = "newest" | "active" | "oldest";

export interface ProjectSummary {
  path: string; // absolute folder path
  lastActivity: number; // ms timestamp, used for ordering (already sorted most recent first)
  cards: number; // total cards in that folder
  running: number; // cards in the Running column
  needsYou: number; // unarchived cards in the Needs you column
}

export interface BoardView {
  project: string | null;
  query: string;
  sort: SortKey;
  showArchived: boolean;
}

// When a card's thread last moved. A card picked up from Claude Code carries its session's last message
// time; its updatedAt also changes when the board only reads the transcript.
export const activeAt = (card: Card) => card.lastActivity ?? card.updatedAt;

export const SORTERS: Record<SortKey, (a: Card, b: Card) => number> = {
  newest: (a, b) => b.createdAt - a.createdAt,
  active: (a, b) => activeAt(b) - activeAt(a),
  oldest: (a, b) => a.createdAt - b.createdAt,
};

// The board's columns: the cards in the chosen project that match the filter, each column sorted.
// rootOf folds a worktree into its main repo, so its cards show under that project.
export function groupByColumn(cards: Card[], view: BoardView, rootOf: (cwd: string) => string) {
  const needle = view.query.trim().toLowerCase();
  const groups = new Map<Column, Card[]>(COLUMNS.map((c) => [c.id, []]));
  for (const card of cards) {
    if (view.project && rootOf(card.cwd) !== view.project) continue;
    if (card.archived && !view.showArchived) continue;
    if (needle) {
      const haystack = [card.title, card.prompt, card.lastLine, card.stage, card.remaining].join(" ").toLowerCase();
      if (!haystack.includes(needle)) continue;
    }
    groups.get(shownColumn(card))?.push(card);
  }
  for (const list of groups.values()) list.sort(SORTERS[view.sort]);
  return groups;
}

// Where the board draws a card: a running one that's wrapping up (/done) already sits in Done.
export function shownColumn(card: Card): Column {
  return card.wrappingUp && card.column === "running" ? "done" : card.column;
}

// The cards a filter matches, most recently active first, for the filter box's quick-open list.
export function topMatches(groups: Map<Column, Card[]>, limit: number): Card[] {
  return [...groups.values()].flat().toSorted(SORTERS.active).slice(0, limit);
}

// Recent projects: saved ones plus every folder a card runs in, most recently active first. Worktrees
// count toward their main repo and never get a chip of their own.
export function summarizeProjects(projects: Project[], cards: Card[], rootOf: (cwd: string) => string) {
  const byPath = new Map<string, ProjectSummary>();
  const summary = (path: string) => {
    let s = byPath.get(path);
    if (!s) byPath.set(path, (s = { path, lastActivity: 0, cards: 0, running: 0, needsYou: 0 }));
    return s;
  };
  for (const p of projects) summary(rootOf(p.path)).lastActivity = Math.max(summary(rootOf(p.path)).lastActivity, p.lastUsedAt);
  for (const card of cards) {
    const s = summary(rootOf(card.cwd));
    s.cards += 1;
    s.lastActivity = Math.max(s.lastActivity, activeAt(card));
    // An archived card is out of sight, so it doesn't light a project's running or needs-you dot.
    if (card.archived) continue;
    if (card.column === "running") s.running += 1;
    if (card.column === "needs_you") s.needsYou += 1;
  }
  return [...byPath.values()].sort((a, b) => b.lastActivity - a.lastActivity);
}

// The most recent card's stats, plus the folder and backend the stats came from, so the bottom
// bar can show "last thread: <folder> [model] 5hr/7d" when no card is open. Limits are
// account-wide; the rest is the last thread's snapshot.
export function latestLimits(cards: Card[]): (CardStats & { cwd: string; backend: Card["backend"] }) | undefined {
  const withStats = cards.filter((c) => c.stats);
  const latest = withStats.sort((a, b) => b.updatedAt - a.updatedAt)[0];
  if (!latest) return undefined;
  return { ...latest.stats, cwd: latest.cwd, backend: latest.backend };
}

// Whether a thread on the board hit its CLI's plan limit, so the Running and Needs you columns
// offer "Switch all" to the other CLI only when there's a reason to switch.
export function hitPlanLimit(cards: Card[]): boolean {
  return cards.some((c) => c.rateLimitHit && !c.archived);
}

// The item `by` steps away from `current`, wrapping at both ends; an unknown current counts as the first.
export function stepThrough<T>(options: readonly T[], current: T, by: number): T {
  const at = Math.max(0, options.indexOf(current));
  const next = options[(at + by + options.length) % options.length];
  return next === undefined ? current : next;
}

export const RECENT_MOVE_MS = 24 * 60 * 60 * 1000;

// The cards that moved column lately, latest move first: what the command palette opens on.
export function recentMoves(cards: Card[], now: number, limit = 5): Card[] {
  return cards
    .filter((c) => c.role !== "copilot" && c.columnAt !== undefined && now - c.columnAt < RECENT_MOVE_MS)
    .toSorted((a, b) => (b.columnAt ?? 0) - (a.columnAt ?? 0))
    .slice(0, limit);
}

// Columns whose arrival marks a card unseen: the ones that want you to look.
export const UNSEEN_COLUMNS: Column[] = ["needs_you", "review", "done"];

// A move you just made yourself doesn't chime; only changes the board or an agent makes do.
export const OWN_MOVE_MS = 3000;

export interface CardChange {
  previous: Column | undefined; // the column last seen, undefined the first time the card shows up
  column: Column;
  previousError: string | undefined;
  error: string | undefined;
  own: { column: Column; at: number } | undefined; // a move you made from this board
  now: number;
  open: boolean; // the card's thread is open
}

// What a card event should set off. A card seen for the first time sets off nothing.
export function cardChangeEffects(change: CardChange) {
  const { previous, column, own } = change;
  const moved = Boolean(previous && previous !== column);
  const mine = moved && own?.column === column && change.now - own.at < OWN_MOVE_MS;
  return {
    moved,
    chime: moved && !mine && column !== "backlog" ? (column as ChimeKind) : null,
    markUnseen: moved && !mine && UNSEEN_COLUMNS.includes(column) && !change.open,
    errorChime: Boolean(previous && change.error && change.error !== change.previousError),
  };
}
