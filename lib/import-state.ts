// Shared state for the Claude Code session pickup: the global sync promise + timers, the
// per-file Tail cache, and the set of cards the sync parked in Running/Needs-you because
// their session was live in another app. Kept on a single global object so the sync
// doesn't go around itself when two cards race.

import type { Column, PermissionMode } from "./types";

export const g = globalThis as unknown as {
  __weftSync?: Promise<unknown>;
  __weftSyncTimer?: ReturnType<typeof setInterval>;
  __weftCheckTimer?: ReturnType<typeof setInterval>;
};

// What the end of a session file says: when its last message was, and whether a turn is in progress.
export interface Tail {
  at: number;
  busy: boolean;
  // The first line of the assistant's last reply, for the card.
  reply?: string;
  // The permission mode Claude Code last recorded for the session.
  mode?: PermissionMode;
}

// A message's content blocks; entries come from disk, so any of them may be null or malformed.
export type Block = { type?: unknown; text?: unknown } | null | undefined;
export const blocksOf = (content: unknown): Block[] => (Array.isArray(content) ? (content as Block[]) : []);

// Cards the sync put in Running or Needs you because their session was live in another app, so it
// moves them back when that ends (and leaves cards the user moved there alone).
export const liveCards = new Set<string>();

// Lines the sync sets as a card's lastLine when its session is live in another app, by column.
export const LIVE_LINES: Partial<Record<Column, string>> = {
  running: "Working in another app",
  needs_you: "Waiting for you in another app",
};
