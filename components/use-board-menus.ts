import { api } from "@/lib/client";
import { cardMenu, columnMenu, resumeCommand, type CardAction, type ColumnAction } from "@/lib/card-menu";
import type { Card, Column, DevServerStatus } from "@/lib/types";

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
  remove: (card: Card) => void;
  // cwd left out, the new-thread dialog picks its usual folder.
  openNew: (cwd?: string) => void;
  toggleArchived: () => void;
  toast: (message: string) => void;
  notify: (err: unknown) => void;
}

// The menus are native (electron/main.cjs). In a plain browser tab there's no shell, so the browser's own menu shows.
export function useBoardMenus(deps: BoardMenuDeps) {
  const shell = typeof window === "undefined" ? undefined : window.threadboard;

  async function onCardMenu(card: Card, e: React.MouseEvent) {
    if (!shell?.popupMenu) return;
    e.preventDefault();
    e.stopPropagation();
    const dev = card.review?.dev ? await api.devStatus(card.id).then((r) => r.status, () => null) : null;
    const picked = (await shell.popupMenu(cardMenu(card, dev))) as CardAction | null;
    if (picked) runCardAction(card, picked).catch(deps.notify);
  }

  async function runCardAction(card: Card, action: CardAction) {
    if (action.startsWith("move:")) return deps.move(card.id, action.slice(5) as Column);
    if (action.startsWith("skill:")) {
      await api.send(card.id, `/${action.slice(6)}`);
      return;
    }
    if (action.startsWith("dev:")) {
      const { status } = await api.devAction(card.id, action.slice(4) as "start" | "restart" | "stop");
      return deps.toast(devMessage(status));
    }
    switch (action) {
      case "open":
        return deps.openCard(card);
      case "rename":
        return deps.renameCard(card);
      case "start":
        return deps.move(card.id, "running");
      case "stop":
        await api.stop(card.id);
        return;
      case "new-here":
        return deps.openNew(card.cwd);
      case "reveal":
        return shell?.revealFolder(card.cwd);
      case "copy-path":
        await navigator.clipboard.writeText(card.cwd);
        return deps.toast("Copied the folder path.");
      case "copy-resume":
        await navigator.clipboard.writeText(resumeCommand(card));
        return deps.toast("Copied. Paste it in a terminal to pick the thread up.");
      case "archive":
        return deps.toggleArchive(card);
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
    const picked = (await shell.popupMenu(menu)) as ColumnAction | null;
    if (picked === "new") deps.openNew();
    if (picked === "toggle-archived") deps.toggleArchived();
    if (picked === "archive-done") {
      await Promise.all(done.map((c) => api.archive(c.id, true))).catch(deps.notify);
    }
  }

  return { onCardMenu, onColumnMenu };
}

function devMessage(status: DevServerStatus): string {
  if (status.state === "stopped") return "Dev server stopped.";
  if (status.state === "failed") return "The dev server failed to start; its log is in the review panel.";
  return "Dev server starting…";
}
