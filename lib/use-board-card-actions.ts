"use client";

import { useCallback, useRef } from "react";
import { api } from "./client";
import { addTag } from "./rail-view";
import type { Card, Column } from "./types";

// What the board does to a card beyond opening it: drag a card to another column, drop it on a tag in
// the 🏷 drawer, and remember a move you just made so its chime is skipped (lib/board-view.ts).
export interface BoardCardActions {
  // The latest cards (Board.tsx) — read fresh on each call so the actions see what the user just did.
  cards: readonly Card[];
  setDragOver: (column: Column | null) => void;
  notify: (err: unknown) => void;
}

export function useBoardCardActions({ cards, setDragOver, notify }: BoardCardActions) {
  // Moves you made, by card: where to and when, so the next event for that card skips its chime.
  const ownMoves = useRef(new Map<string, { column: Column; at: number }>());

  // Moves a card for you, remembering it so the move doesn't chime.
  const move = useCallback(
    (id: string, column: Column) => {
      ownMoves.current.set(id, { column, at: Date.now() });
      api.move(id, column).catch(notify);
    },
    [notify],
  );

  // A card dropped on a column moves there if it's not already; clears the drag highlight.
  const drop = useCallback(
    (column: Column, e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(null);
      const id = e.dataTransfer.getData("text/plain");
      const card = cards.find((c) => c.id === id);
      if (card && card.column !== column) move(id, column);
    },
    [cards, setDragOver, move],
  );

  // A card dropped on a tag in the 🏷 drawer gets that tag.
  const tagCard = useCallback(
    (cardId: string, tag: string) => {
      const card = cards.find((c) => c.id === cardId);
      const next = card && addTag(card.tags, tag);
      if (next) api.mark(cardId, { tags: next }).catch(notify);
    },
    [cards, notify],
  );

  return { ownMoves, move, drop, tagCard };
}
