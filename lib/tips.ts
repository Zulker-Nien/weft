import type { Column } from "./types-card";

// One-time coach tips (components/CoachTip.tsx): the board explains each column the first time a card reaches it,
// one tip at a time, in this order. Which ones you've seen live in localStorage, so Got it is for good until
// Settings → General → Reset tips.

export type TipId = "needs-you" | "review" | "done" | "profile";
export type ColumnCounts = Partial<Record<Column, number>>;

export type Tip = {
  id: TipId;
  // The column header the bubble sits under.
  column: Column;
  text: string;
  // A button beside Got it; "profile" opens the Wefter Profile.
  action?: { label: string; kind: "profile" };
  when: (counts: ColumnCounts) => boolean;
};

const n = (counts: ColumnCounts, column: Column) => counts[column] ?? 0;

export const TIPS: readonly Tip[] = [
  { id: "needs-you", column: "needs_you", text: "Your thread is asking you something. Answer it above the reply box.", when: (c) => n(c, "needs_you") > 0 },
  { id: "review", column: "review", text: "Finished. Open it and Weft walks you through the change in the browser pane.", when: (c) => n(c, "review") > 0 },
  {
    id: "done",
    column: "done",
    text: "Happy with it? Drag it to Done: Weft commits, pushes and tidies docs and tests.",
    when: (c) => n(c, "review") > 0 && n(c, "done") === 0,
  },
  {
    id: "profile",
    column: "done",
    text: "Your first card is done. See your Wefter Profile.",
    action: { label: "Open profile", kind: "profile" },
    when: (c) => n(c, "done") > 0,
  },
];

export const TIPS_KEY = "weft-tips-seen";
// Sent on the window when the seen set changes (Got it, Reset tips), so the board's hook reads it again.
export const TIPS_CHANGED = "weft:tips-changed";

type TipStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): TipStorage | null {
  try {
    return (globalThis as { localStorage?: Storage }).localStorage ?? null;
  } catch {
    return null;
  }
}

export function loadSeen(storage: TipStorage | null = defaultStorage()): Set<TipId> {
  try {
    const raw: unknown = JSON.parse(storage?.getItem(TIPS_KEY) ?? "[]");
    const ids = new Set<string>(TIPS.map((t) => t.id));
    return new Set(Array.isArray(raw) ? (raw.filter((id) => typeof id === "string" && ids.has(id)) as TipId[]) : []);
  } catch {
    return new Set();
  }
}

export function markSeen(id: TipId, storage: TipStorage | null = defaultStorage()): Set<TipId> {
  const seen = loadSeen(storage);
  seen.add(id);
  try {
    storage?.setItem(TIPS_KEY, JSON.stringify([...seen]));
  } catch {
    // Storage full or blocked: the tip still goes away for this session.
  }
  return seen;
}

export function resetTips(storage: TipStorage | null = defaultStorage()) {
  try {
    storage?.removeItem(TIPS_KEY);
  } catch {
    // Nothing saved to clear.
  }
}

// The first tip, in order, that's unseen and whose column state holds. Counts are per column, copilot excluded.
export function nextTip(counts: ColumnCounts, seen: ReadonlySet<TipId>): TipId | null {
  return TIPS.find((t) => !seen.has(t.id) && t.when(counts))?.id ?? null;
}

export const tipById = (id: TipId) => TIPS.find((t) => t.id === id) as Tip;

// Unarchived cards per column, with the copilot left out.
export function columnCounts(cards: readonly { column: Column; archived?: boolean; role?: string }[]): ColumnCounts {
  const counts: ColumnCounts = {};
  for (const c of cards) if (!c.archived && c.role !== "copilot") counts[c.column] = (counts[c.column] ?? 0) + 1;
  return counts;
}
