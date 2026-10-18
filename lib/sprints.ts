import type { Card } from "./types";

// Sprints: the Backlog's cards saved as a named list (the Backlog header's Save as sprint), so the
// lane can be archived and a sprint brought back later from the list under "Backlog".
// Kept in ~/.weft/sprints.json by lib/sprint-store.ts.

export interface Sprint {
  id: string;
  name: string;
  cardIds: string[];
  createdAt: number;
}

const MAX_NAME = 80;

export function cleanSprintName(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const name = raw.replace(/\s+/g, " ").trim().slice(0, MAX_NAME);
  return name || undefined;
}

// "Sprint 3 · Oct 18": one more than the highest numbered sprint so far, so deleting one never repeats a name.
export function defaultSprintName(sprints: readonly Sprint[], now: number): string {
  const highest = sprints.reduce((n, s) => Math.max(n, Number(/^Sprint (\d+)/.exec(s.name)?.[1] ?? 0)), 0);
  const day = new Date(now).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `Sprint ${highest + 1} · ${day}`;
}

// Card ids from a request body: strings, no repeats.
export function cleanCardIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((id): id is string => typeof id === "string" && id.length > 0))];
}

export interface SprintView {
  sprint: Sprint;
  // Its cards still on the board (a deleted card drops out).
  cards: Card[];
  // The ones archived, which Restore brings back.
  archived: Card[];
  // The ones that moved on from the Backlog (started, done).
  started: number;
}

// What the sprints list shows for each sprint, newest first.
export function sprintViews(sprints: readonly Sprint[], cards: readonly Card[]): SprintView[] {
  const byId = new Map(cards.map((c) => [c.id, c]));
  return [...sprints]
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((sprint) => {
      const mine = sprint.cardIds.flatMap((id) => byId.get(id) ?? []);
      return {
        sprint,
        cards: mine,
        archived: mine.filter((c) => c.archived),
        started: mine.filter((c) => c.column !== "backlog").length,
      };
    });
}
