"use client";

import { useCallback, useRef, useState } from "react";
import { api } from "./client";
import { playChime } from "./chimes";
import type { Card, Column } from "./types";

// The copilot's card on the board. It's a thread too, but it has its own window and no project, so the
// board keeps it apart from `cards` (counts, palette and pile leave it out) and draws it atop its column.
export function useCopilotCard() {
  const [copilot, setCopilot] = useState<Card | null>(null);
  const column = useRef<Column | null>(null);

  // A live update: chime when it moves into Needs you, as any card does.
  const update = useCallback((card: Card) => {
    if (column.current && column.current !== "needs_you" && card.column === "needs_you") playChime("needs_you");
    column.current = card.column;
    setCopilot(card);
  }, []);

  // A (re)load: no chime, since nothing moved while you watched.
  const load = useCallback(() => {
    api
      .copilot()
      .then(({ card }) => {
        column.current = card.column;
        setCopilot(card);
      })
      .catch(() => {});
  }, []);

  return { copilot, update, load };
}
