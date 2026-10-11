import { api } from "@/lib/client";
import { cardMenu, columnMenu, starMenu, resumeCommand, withAccelerators, type CardAction, type ColumnAction } from "@/lib/card-menu";
import { toAccelerator, useShortcutList } from "@/lib/hotkeys";
import type { Card, Column, DevServerStatus, LibraryKind, PermissionMode } from "@/lib/types";

// What the board's right-click menus act through: the same functions its buttons, drag and command palette use.
export interface BoardMenuDeps {
  // The Done cards on screen (project filter and search applied), and how many there are archived.
  doneShown: Card[];
  archivedCount: number;
  showArchived: boolean;
  openCard: (card: Card) => void;
  // Opens the card with its title ready to edit.
  renameCard: (card: Card) => void;
  move: (id: string, column: Column) => void;
  toggleArchive: (card: Card) => void;
  // Archives with an Undo toast.
  archive: (cards: Card[]) => void;
  remove: (card: Card) => void;
  // cwd left out, the new-thread dialog picks its usual folder.
  openNew: (cwd?: string) => void;
  toggleArchived: () => void;
  // Files the card in the library (lib/library.ts), and opens the library drawer on a kind.
  star: (card: Card, kind: LibraryKind) => void;
  showLibrary: (kind: LibraryKind) => void;
  toast: (message: string) => void;
  notify: (err: unknown) => void;
}

// The menus are native (electron/main.cjs). In a plain browser tab there's no shell, so the browser's own menu shows.
export function useBoardMenus(deps: BoardMenuDeps) {
  const shell = typeof window === "undefined" ? undefined : window.threadboard;
  // Menu items that have a board shortcut use its key, read from the registry: menu item id -> shortcut id.
  // Keys the open menu handles itself (Return, arrows…) are skipped, so card-open shows O, not ↩.
  const shortcuts = useShortcutList();
  const keys = (map: Record<string, string>) =>
    Object.fromEntries(
      Object.entries(map).map(([item, id]) => {
        const spec = shortcuts.find((s) => s.id === id)?.keys.find((k) => !MENU_OWN_KEYS.test(k));
        return [item, spec && toAccelerator(spec)];
      }),
    );

  async function onCardMenu(card: Card, e: React.MouseEvent) {
    if (!shell?.popupMenu) return;
    e.preventDefault();
    e.stopPropagation();
    const dev = card.review?.dev ? await api.devStatus(card.id).then((r) => r.status, () => null) : null;
    const picked = (await shell.popupMenu(withAccelerators(cardMenu(card, dev), keys({ open: "card-open", archive: "archive" })))) as CardAction | null;
    if (picked) runCardAction(card, picked).catch(deps.notify);
  }

  // Star, unstar, show in library. True when the action was one of these.
  async function runLibraryAction(card: Card, action: CardAction) {
    if (action.startsWith("star:")) {
      deps.star(card, action.slice(5) as LibraryKind);
    } else if (action === "unstar") {
      if (card.libraryId) await api.removeLibraryItem(card.libraryId);
      deps.toast(`Took “${card.title}” out of the library.`);
    } else if (action === "show-in-library") {
      const { items } = await api.library(null, true);
      const kind = items.find((i) => i.id === card.libraryId)?.kind;
      if (kind) deps.showLibrary(kind);
      else deps.toast("It isn't in the library any more.");
    } else {
      return false;
    }
    return true;
  }

  async function runCardAction(card: Card, action: CardAction) {
    if (await runLibraryAction(card, action)) return;
    if (action.startsWith("move:")) {
      deps.move(card.id, action.slice(5) as Column);
      return;
    }
    if (action.startsWith("skill:")) {
      await api.send(card.id, `/${action.slice(6)}`);
      return;
    }
    if (action.startsWith("mode:")) {
      await api.setMode(card.id, action.slice(5) as PermissionMode);
      return;
    }
    if (action.startsWith("dev:")) {
      const { status } = await api.devAction(card.id, action.slice(4) as "start" | "restart" | "stop");
      deps.toast(devMessage(status));
      return;
    }
    switch (action) {
      case "open":
        deps.openCard(card);
        return;
      case "rename":
        deps.renameCard(card);
        return;
      case "start":
        deps.move(card.id, "running");
        return;
      case "stop":
        await api.stop(card.id);
        return;
      case "new-here":
        deps.openNew(card.cwd);
        return;
      case "reveal":
        return shell?.revealFolder(card.cwd);
      case "copy-path":
        await navigator.clipboard.writeText(card.cwd);
        deps.toast("Copied the folder path.");
        return;
      case "copy-resume":
        await navigator.clipboard.writeText(resumeCommand(card));
        deps.toast("Copied. Paste it in a terminal to pick the thread up.");
        return;
      case "archive":
        deps.toggleArchive(card);
        return;
      case "delete":
        if (window.confirm(`Delete “${card.title}”? Its CLI transcript stays on disk.`)) deps.remove(card);
        return;
    }
  }

  // Right-clicking a column's empty space; a card's own menu stops the event before it gets here.
  async function onColumnMenu(column: Column, e: React.MouseEvent) {
    if (!shell?.popupMenu) return;
    e.preventDefault();
    const done = deps.doneShown.filter((c) => !c.archived);
    const menu = columnMenu(column, { count: done.length, archived: deps.archivedCount, showArchived: deps.showArchived });
    const picked = (await shell.popupMenu(withAccelerators(menu, keys({ new: "new-thread", "archive-done": "archive-done" })))) as ColumnAction | null;
    if (picked === "new") deps.openNew();
    if (picked === "toggle-archived") deps.toggleArchived();
    if (picked === "archive-done") deps.archive(done);
  }

  // The ☆ on a card or in its thread: star it as a recipe, to-do or note, or show or unstar it. Outside the
  // desktop app there's no native menu, so a click stars it as a note.
  async function onStarMenu(card: Card, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!shell?.popupMenu) {
      if (!card.libraryId) deps.star(card, "note");
      return;
    }
    const picked = (await shell.popupMenu(starMenu(card))) as CardAction | null;
    if (picked) runCardAction(card, picked).catch(deps.notify);
  }

  return { onCardMenu, onColumnMenu, onStarMenu };
}

// Keys a native menu uses to move and pick, so they can't be an item's key.
const MENU_OWN_KEYS = /^(Enter|Escape|Tab| |Arrow\w+|Home|End)$/;

function devMessage(status: DevServerStatus): string {
  if (status.state === "stopped") return "Dev server stopped.";
  if (status.state === "failed") return "The dev server failed to start; its log is in the review panel.";
  return "Dev server starting…";
}
