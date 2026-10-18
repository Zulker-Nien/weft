"use client";

import { useCallback, useRef } from "react";
import { api } from "./client";
import { addTag } from "./rail-view";
import type { Card, Column } from "./types";

// What the board does to a card beyond opening it: drag a card to another column, drop it on a tag in
// the 🏷 drawer, drop it on a backlog card to reorder, and remember a move you just made so its
// chime is skipped (lib/board-view.ts).
export interface BoardCardActions {
  // The latest cards (Board.tsx) — read fresh on each call so the actions see what the user just did.
  cards: readonly Card[];
  // Apply an optimistic update to the cards state. Used by reorder so the new order lands
  // before the server's PATCH round-trips.
  setCards: (updater: (cards: Card[]) => Card[]) => void;
  setDragOver: (column: Column | null) => void;
  notify: (err: unknown) => void;
}

// Half-step the store uses between orders, copied here so the optimistic update lands at
// the same value the server will compute. Keep these in sync with lib/store.ts.
const ORDER_STEP = 1024;

export function useBoardCardActions({ cards, setCards, setDragOver, notify }: BoardCardActions) {
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

  // A backlog card dropped on a sibling. `before` is the indicator side: true for the top
  // half (place before target), false for the bottom (place after). Mirrors the same
  // half-step math as lib/store.ts reorderCard, so the optimistic order matches the
  // server's.
  const reorder = useCallback(
    (id: string, target: string, before: boolean) => {
      const moved = cards.find((c) => c.id === id);
      if (!moved) return;
      // Siblings in the same column, sorted by current order then the column's chosen
      // fallback (createdAt — every card has one), so prev/next are deterministic.
      const siblings = cards
        .filter((c) => c.column === moved.column && c.id !== id)
        .slice()
        .sort((a, b) => (a.order ?? a.createdAt) - (b.order ?? b.createdAt));
      const targetIndex = siblings.findIndex((c) => c.id === target);
      if (targetIndex < 0) return;
      // The drop slot: top half -> before target; bottom half -> after target.
      const slot = before ? targetIndex : targetIndex + 1;
      const prevSibling = slot > 0 ? siblings[slot - 1] : undefined;
      const nextSibling = slot < siblings.length ? siblings[slot] : undefined;
      const prev = prevSibling?.order;
      const next = nextSibling?.order;
      let newOrder: number;
      if (prev === undefined && next === undefined) newOrder = ORDER_STEP;
      else if (prev === undefined) newOrder = (next as number) - ORDER_STEP;
      else if (next === undefined) newOrder = prev + ORDER_STEP;
      else {
        const gap = next - prev;
        newOrder = gap >= 2 ? prev + Math.floor(gap / 2) : prev + ORDER_STEP;
      }
      setCards((cur) => cur.map((c) => (c.id === id ? { ...c, order: newOrder } : c)));
      api.reorder(id, before ? target : null).catch(notify);
    },
    [cards, setCards, notify],
  );

  return { ownMoves, move, drop, reorder, tagCard };
}
