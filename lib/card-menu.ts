import { isLive } from "./format";
import { BACKEND_LABELS, LIBRARY_KINDS, MODE_OPTIONS, type Backend, type Card, type Column, type DevServerStatus, type LibraryKind, type PermissionMode } from "./types";

// The right-click menus on the board, as plain data: the board builds them, the desktop shell
// shows them natively (electron/main.cjs) and hands back the id of the item picked.
// Everything is one click: no submenus.

// checked shows a tick (the card's current permission mode). accelerator is the item's key (an Electron
// accelerator, e.g. "Shift+A"): drawn beside it, and pressing it while the menu is open picks the item.
export type MenuItem =
  | { id: string; label: string; enabled?: boolean; checked?: boolean; accelerator?: string }
  | { type: "separator" };

export type CardAction =
  | "open"
  | "rename"
  | "start"
  | `move:${Column}`
  | "stop"
  | `skill:${string}`
  | `mode:${PermissionMode}`
  | `switch:${Backend}`
  | "dev:start"
  | "dev:restart"
  | "dev:stop"
  | "new-here"
  | "reveal"
  | "copy-path"
  | "copy-resume"
  | `star:${LibraryKind}`
  | "unstar"
  | "show-in-library"
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

// Every item's key while its menu is open, by item id. Items with a board shortcut get the board's key
// instead (components/use-board-menus.ts), so the two always agree. Letters are free here: the board's
// own keys don't run while a menu is open. Not Return, Escape, Space or arrows: the open menu uses those.
const MENU_KEYS: Record<string, string> = {
  open: "O",
  rename: "R",
  start: "S",
  "move:review": "V",
  "move:done": "D",
  "move:backlog": "B",
  stop: "X",
  "dev:start": "L",
  "dev:restart": "L",
  "dev:stop": "Shift+L",
  "mode:bypassPermissions": "Y",
  "mode:auto": "U",
  "mode:acceptEdits": "E",
  "mode:default": "M",
  "switch:claude": "J",
  "switch:puku": "J",
  "new-here": "N",
  reveal: "F",
  "copy-path": "C",
  "copy-resume": "Shift+C",
  "star:recipe": "Shift+R",
  "star:todo": "T",
  "star:note": "K",
  unstar: "Shift+K",
  "show-in-library": "I",
  archive: "Shift+A",
  delete: "CmdOrCtrl+Backspace",
  // Column menus.
  new: "N",
  "toggle-archived": "H",
  "archive-done": "Shift+E",
  // The skills go 1, 2, 3 in MENU_SKILLS order.
  ...Object.fromEntries(MENU_SKILLS.map((skill, i) => [`skill:${skill}`, String(i + 1)])),
};

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
  devServerItems(card, dev, items);
  items.push(SEPARATOR);

  permissionsItems(card, items);
  items.push(SEPARATOR);

  switchItem(card, live, items);
  items.push(SEPARATOR);

  fileItems(card, items);
  items.push(SEPARATOR);

  items.push(...starItems(card), SEPARATOR);

  archiveItems(card, items);
  return withAccelerators(items, MENU_KEYS);
}

// Dev server start/restart/stop, based on the current state.
function devServerItems(card: Card, dev: DevServerStatus | null | undefined, items: MenuItem[]): void {
  if (!card.review?.dev) return;
  const up = dev?.state === "running" || dev?.state === "starting" || Boolean(dev?.reachable);
  if (up) items.push({ id: "dev:restart", label: "Restart Dev Server" }, { id: "dev:stop", label: "Stop Dev Server" });
  else items.push({ id: "dev:start", label: "Start Dev Server" });
}

// Applies mid-turn too. Only Claude Code board threads can skip every prompt (YOLO).
function permissionsItems(card: Card, items: MenuItem[]): void {
  for (const m of MODE_OPTIONS) {
    if (m.id === "bypassPermissions" && card.backend !== "claude") continue;
    items.push({ id: `mode:${m.id}`, label: `Permissions: ${m.label}`, checked: card.permissionMode === m.id });
  }
}

// The escape hatch for plan limits: one-click flip to the other CLI. Disabled mid-turn because
// the endpoint refuses; the menu should match.
function switchItem(card: Card, live: boolean, items: MenuItem[]): void {
  const otherBackend: Backend = card.backend === "puku" ? "claude" : "puku";
  items.push({
    id: `switch:${otherBackend}`,
    label: `Run on ${BACKEND_LABELS[otherBackend]}${card.rateLimitHit ? " (hit plan limit)" : ""}`,
    enabled: !live,
  });
}

// New thread, reveal in Finder, copy path, copy resume.
function fileItems(card: Card, items: MenuItem[]): void {
  items.push({ id: "new-here", label: "New Thread in This Folder" }, { id: "reveal", label: "Reveal Folder in Finder" });
  items.push({ id: "copy-path", label: "Copy Folder Path" });
  if (card.sessionId && card.backend === "claude") items.push({ id: "copy-resume", label: "Copy Resume Command" });
}

// Archive or unarchive, and delete.
function archiveItems(card: Card, items: MenuItem[]): void {
  items.push({ id: "archive", label: card.archived ? "Unarchive" : "Archive" }, { id: "delete", label: "Delete…" });
}

// Starring files the card in the library (lib/library.ts); a starred card is never auto-archived.
function starItems(card: Card): MenuItem[] {
  if (card.libraryId) return [{ id: "show-in-library", label: "Show in Library" }, { id: "unstar", label: "Unstar (Remove from Library)" }];
  return LIBRARY_KINDS.map((k) => ({ id: `star:${k.id}`, label: k.id === "recipe" ? "Save as Recipe" : `Star as ${k.label}` }));
}

// The ☆ on a card and in its thread's header: just the library part of the card's menu.
export function starMenu(card: Card): MenuItem[] {
  return withAccelerators(starItems(card), MENU_KEYS);
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
  if (column === "done") {
    if (done.archived > 0) items.push({ id: "toggle-archived", label: done.showArchived ? "Hide Archived" : `Show ${done.archived} Archived` });
    if (done.count > 0) items.push(SEPARATOR, { id: "archive-done", label: `Archive All ${done.count} in Done` });
  }
  return withAccelerators(items, MENU_KEYS);
}

// Gives items their keys, by item id (Electron accelerators); an id left out or undefined keeps its key.
export function withAccelerators(items: MenuItem[], keys: Record<string, string | undefined>): MenuItem[] {
  return items.map((item) => ("id" in item && keys[item.id] ? { ...item, accelerator: keys[item.id] } : item));
}
