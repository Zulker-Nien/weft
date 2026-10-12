// What a card that isn't running can do from its own buttons (components/CardResume.tsx). Pure, for the board.
import type { Card } from "./types";

export type ResumeHow = "continue" | "restart";

// A card's last line when the app closed in the middle of its turn (lib/store.ts).
export const CLOSED_LINE = "Stopped when the app closed";
// How many carry-on turns in a row lib/resume.ts sends after restarts before leaving the card stopped.
export const MAX_RESUMES = 3;

// The ▶ on a card: send "continue" into its session, for when the thread gave up too early. Any card with a
// session that isn't running or waiting on a permission or a login, and isn't Done, filed away or the copilot.
export function canContinue(card: Card) {
  if (!card.sessionId || card.role === "copilot" || card.archived || card.pending) return false;
  if (card.column === "running" || card.column === "done") return false;
  return !(card.column === "needs_you" && card.lastLine?.startsWith("Log in to "));
}

// Restart on a card whose turn was stopped or failed: its last message again, in a fresh CLI.
export function canRestart(card: Card) {
  if (card.role === "copilot" || card.archived || card.pending) return false;
  if (card.column === "running" || card.column === "needs_you" || card.column === "done") return false;
  return Boolean(card.lastLine?.startsWith("Stopped")) || Boolean(card.error);
}

// Resume all, at the top of Review: the cards there whose turn the app closed on or that failed (not the ones you
// stopped yourself). Each gets "continue" in its session, or its last message again when it has none.
export function resumeAllTargets(cards: Card[]): { id: string; how: ResumeHow }[] {
  return cards
    .filter((c) => c.column === "review" && canRestart(c) && (c.lastLine === CLOSED_LINE || Boolean(c.error)))
    .map((c) => ({ id: c.id, how: c.sessionId ? "continue" : "restart" }));
}
