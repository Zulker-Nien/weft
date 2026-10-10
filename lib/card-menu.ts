import { isLive } from "./format";
import type { Card, Column, DevServerStatus } from "./types";

// The right-click menus on the board, as plain data: the board builds them, the desktop shell
// shows them natively (electron/main.cjs) and hands back the id of the item picked.
// Everything is one click: no submenus.

export type MenuItem = { id: string; label: string; enabled?: boolean } | { type: "separator" };

export type CardAction =
  | "open"
  | "rename"
  | "start"
  | `move:${Column}`
  | "stop"
  | `skill:${string}`
  | "dev:start"
  | "dev:restart"
  | "dev:stop"
  | "new-here"
  | "reveal"
  | "copy-path"
  | "copy-resume"
  | "archive"
  | "delete";

const SEPARATOR: MenuItem = { type: "separator" };

// Weft's own skills, offered on every card.
export const MENU_SKILLS = ["weft:done", "weft:commit", "weft:preview"];

// Columns you can move a card to by hand (app/api/cards/[id]/route.ts); Running and Needs you follow the thread.
const MOVES: { column: Column; label: string }[] = [
  { column: "review", label: "Move to Review" },
  { column: "done", label: "Move to Done" },
  { column: "backlog", label: "Move to Backlog" },
];

// dev is the card's dev server, when its review plan names one.
export function cardMenu(card: Card, dev?: DevServerStatus | null): MenuItem[] {
  const live = isLive(card);
  const items: MenuItem[] = [{ id: "open", label: "Open Thread" }, { id: "rename", label: "Rename…" }, SEPARATOR];

  if (card.column === "backlog") items.push({ id: "start", label: "Start Now" });
  for (const m of MOVES) {
    if (m.column !== card.column) items.push({ id: `move:${m.column}`, label: m.label, enabled: !live });
  }
  items.push(SEPARATOR);

  if (live) items.push({ id: "stop", label: "Stop Turn" });
  for (const skill of MENU_SKILLS) items.push({ id: `skill:${skill}`, label: `Run /${skill}`, enabled: !live });
  if (card.review?.dev) {
    const up = dev?.state === "running" || dev?.state === "starting" || Boolean(dev?.reachable);
    if (up) items.push({ id: "dev:restart", label: "Restart Dev Server" }, { id: "dev:stop", label: "Stop Dev Server" });
    else items.push({ id: "dev:start", label: "Start Dev Server" });
  }
  items.push(SEPARATOR);

  items.push({ id: "new-here", label: "New Thread in This Folder" }, { id: "reveal", label: "Reveal Folder in Finder" });
  items.push({ id: "copy-path", label: "Copy Folder Path" });
  if (card.sessionId && card.backend === "claude") items.push({ id: "copy-resume", label: "Copy Resume Command" });
  items.push(SEPARATOR);

  items.push({ id: "archive", label: card.archived ? "Unarchive" : "Archive" }, { id: "delete", label: "Delete…" });
  return items;
}

// What to paste in a terminal to pick the thread up in Claude Code.
export function resumeCommand(card: Card): string {
  return `cd ${shellQuote(card.cwd)} && claude --resume ${card.sessionId}`;
}

function shellQuote(s: string): string {
  return /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}

export type ColumnAction = "new" | "toggle-archived" | "archive-done";

// Right-clicking a column's empty space.
export function columnMenu(column: Column, done: { count: number; archived: number; showArchived: boolean }): MenuItem[] {
  const items: MenuItem[] = [{ id: "new", label: "New Thread" }];
  if (column !== "done") return items;
  if (done.archived > 0) items.push({ id: "toggle-archived", label: done.showArchived ? "Hide Archived" : `Show ${done.archived} Archived` });
  if (done.count > 0) items.push(SEPARATOR, { id: "archive-done", label: `Archive All ${done.count} in Done` });
  return items;
}
