// The Card interface and its closest dependents (CardIssue). Lives in its own module
// to keep types-card.ts under the line limit; re-exported by it so the public shape
// of ./types is unchanged.

import type { Backend, CardStats, Column, PendingPermission, ReviewPlan, ScheduledMessage } from "./types-card";
import type { Effort } from "./types-settings";
export type { CardStats, Column };

export interface Card {
  id: string;
  title: string;
  prompt: string;
  cwd: string;
  backend: Backend;
  permissionMode: import("./types-card").PermissionMode;
  // Chosen when the thread was made; left out, the CLI's own default.
  model?: string;
  effort?: Effort;
  // The model's and effort's value before a Done move patched them for the /weft:done turn
  // (app/api/cards/[id] moveCard). Cleared by restoreDoneOverride once that turn ends.
  preDoneModel?: string;
  preDoneEffort?: Effort;
  column: Column;
  // When the card last moved to another column; the command palette opens on the latest moves.
  columnAt?: number;
  // Filed away after its Done automations finished; the board hides it until "Show archived".
  archived?: boolean;
  // Running its /done (or Done's automations) and archived when that ends: the board shows it in Done meanwhile.
  wrappingUp?: boolean;
  // Skills a "prompt-matches" automation has already run in this thread, so each runs once.
  promptSkills?: string[];
  // The card whose thread started this one, via the board tools.
  parentId?: string;
  sessionId?: string;
  lastLine?: string;
  costUsd?: number;
  stats?: CardStats;
  turns?: number;
  error?: string;
  // Set when the thread's last turn hit the plan's rate limit, so the card menu and banner can
  // offer a one-click "Run on <other>" escape. Cleared by switchBackend on a successful switch.
  rateLimitHit?: boolean;
  pending?: PendingPermission | null;
  // The copilot is a thread too, but it lives in its own window instead of on the board.
  role?: "copilot";
  // A CLI process is open for this thread, so a reply starts right away.
  warm?: boolean;
  // From the thread's own BOARD STATUS line (see lib/status.ts).
  stage?: string;
  remaining?: string;
  // The CLI's guess at your next message after a turn (the SDK's prompt suggestions); the reply box
  // shows it as its placeholder and Tab fills it in. Cleared when you send.
  suggestion?: string;
  // From the thread's weft-review block; replaced each time it sends a new one.
  review?: ReviewPlan;
  // Files the thread has edited (Edit, Write, MultiEdit, NotebookEdit), most recent first, capped
  // (lib/overlap.ts), for the warning when busy cards in one folder edit the same files.
  touchedFiles?: string[];
  // Top-level symbols (or whole files) the thread edited and hasn't committed, most recent first, capped:
  // "/abs/Board.tsx#CommandPalette", "/abs/a.css#*" (lib/claims.ts). Dropped at Done, archive and commit.
  claims?: string[];
  // Set on cards picked up from existing Claude Code sessions (see lib/import.ts).
  source?: "claude-code";
  // When the session last changed (its last message), and when its transcript was last read into the thread.
  lastActivity?: number;
  transcriptAt?: number;
  // The session is open in another app (the Claude app or a terminal) right now, so Weft won't write to it.
  openElsewhere?: boolean;
  // When a picked-up session looked active in another app, Weft continued it as a copy of this one.
  forkedFrom?: string;
  // When Weft last finished a turn on this card, to tell its own session writes from other apps'.
  lastWeftTurn?: number;
  // The card's thumbnail (lib/card-pictures.ts): its latest picture, and how many images its thread holds.
  thumb?: string;
  pictures?: number;
  // Haiku's emoji for the card, shown in place of a thumbnail until it has one.
  emoji?: string;
  // Who last named the card: you (typed or renamed it) or Weft's retitle after its first turn (lib/retitle.ts).
  // Either way, Claude Code's own session title no longer replaces it.
  titleBy?: "user" | "auto";
  // ★: worth keeping. A starred card is never auto-archived.
  starred?: boolean;
  // Directories the user has approved this thread to read from, beyond cwd (the card's project folder).
  // Stored on the card so a resumed session keeps the read scope; passed to the SDK as
  // additionalDirectories. A run-time `/add-dir` slash command isn't enough on its own — the path
  // has to be a subdirectory of cwd or another already-granted directory at session launch.
  readScope?: string[];
  // Short labels (lib/tags.ts), the same rules as GitHub labels so they sync with an issue's. Weft's
  // retitle picks them after a turn (tagsBy "auto") until you edit them (tagsBy "user").
  tags?: string[];
  tagsBy?: "user" | "auto";
  // The GitHub issue this card came from (lib/github-issues.ts).
  issue?: CardIssue;
  // Messages to send at a set time (lib/schedule.ts), soonest first; lib/scheduler.ts sends them.
  scheduled?: ScheduledMessage[];
  // A turn the app closed in the middle of; lib/resume.ts carries it on after the restart. `resumes` counts the
  // carry-on turns in a row (your own message resets it), so a turn that keeps getting cut off stops after a few.
  interrupted?: boolean;
  resumes?: number;
  createdAt: number;
  updatedAt: number;
}

export interface CardIssue {
  // "owner/name"
  repo: string;
  number: number;
  url: string;
  state: "open" | "closed";
  // The issue's updated_at when Weft last read it, to tell its edits from ours.
  updatedAt: string;
}