"use client";

import { useCallback, useRef, useState } from "react";
import { api } from "./client";
import { playChime } from "./chimes";
import type { Card, Column } from "./types";

// The copilot's card. It's a thread too, but it has its own lane (components/CopilotLane.tsx) and no project,
// so the board keeps it apart from `cards` (counts, palette and pile leave it out); this tracks it for the
// Copilot button's Needs you dot and its chime.
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
