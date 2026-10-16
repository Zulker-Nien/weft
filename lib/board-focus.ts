"use client";

// Keyboard focus on the board: move between cards and columns, jump to cards waiting on you,
// open the focused card, focus the filter box. Pure functions that read the DOM and the open
// card; the Board wires them up with its state.
import type { Card, Column } from "./types";

const FILTER_PLACEHOLDER = "Filter cards";

// True if the filter box has keyboard focus (the filter's `?` shortcut only fires from there).
export function filterHasFocus(): boolean {
  return document.activeElement === document.querySelector(`input[placeholder="${FILTER_PLACEHOLDER}"]`);
}

// Focus the filter box and select its text.
export function focusFilter(): void {
  const input = document.querySelector<HTMLInputElement>(`input[placeholder="${FILTER_PLACEHOLDER}"]`);
  input?.focus();
  input?.select();
}

const inColumn = (id: string) => [...document.querySelectorAll<HTMLElement>(`[data-column="${id}"] [data-card-id]`)];

// Step dx columns from `column` to the next one with cards and focus the card at the same row.
function focusAcross(ids: string[], column: string, row: number, dx: number): void {
  for (let i = ids.indexOf(column) + dx; i >= 0 && i < ids.length; i += dx) {
    const next = inColumn(ids[i] ?? "");
    if (next.length) {
      next[Math.min(row, next.length - 1)]?.focus();
      return;
    }
  }
}

// The row a up/down/first/last move lands on, clamped to the column.
function targetRow(move: { dy?: number; edge?: "first" | "last" }, row: number, length: number): number {
  const target = move.edge === "first" ? 0 : move.edge === "last" ? length - 1 : row + (move.dy ?? 0);
  return Math.max(0, Math.min(length - 1, target));
}

// Move keyboard focus between rendered cards. dx steps to the next column that has cards,
// dy up or down the current one, and "first" / "last" jump within it. With nothing focused it
// starts at the open card, or else the first card on the board.
export function moveFocus(
  move: { dx?: number; dy?: number; edge?: "first" | "last" },
  visibleColumns: ReadonlyArray<{ id: Column }>,
  selectedId: string | null,
  selectedColumn: Column | null,
): void {
  const current =
    document.activeElement?.closest<HTMLElement>("[data-card-id]") ??
    (selectedId ? inColumn(selectedColumn ?? "").find((el) => el.dataset.cardId === selectedId) : undefined);
  const ids = visibleColumns.map((c) => c.id);
  const column = current?.closest<HTMLElement>("[data-column]")?.dataset.column as Column | undefined;
  if (!current || !column) {
    ids.map(inColumn).find((list) => list.length > 0)?.[0]?.focus();
    return;
  }
  const list = inColumn(column);
  const row = list.indexOf(current);
  if (move.dx) focusAcross(ids, column, row, move.dx);
  else list[targetRow(move, row, list.length)]?.focus();
}

// Jump to a card in the Needs you column (round-robin through them).
export function jumpToNeedsYou(): false | undefined {
  const list = [...document.querySelectorAll<HTMLElement>('[data-column="needs_you"] [data-card-id]')];
  if (!list.length) return false;
  const at = list.findIndex((el) => el.contains(document.activeElement));
  list[(at + 1) % list.length]?.focus();
}

// Enter only opens a card that has focus itself, so it still presses a button inside one.
export function openFocused(
  e: KeyboardEvent,
  cards: readonly Card[],
  openCard: (card: Card) => void,
): false | undefined {
  const el = document.activeElement?.closest<HTMLElement>("[data-card-id]");
  const card = cards.find((c) => c.id === el?.dataset.cardId);
  if (!card || (e.key === "Enter" && e.target !== el)) return false;
  openCard(card);
}
