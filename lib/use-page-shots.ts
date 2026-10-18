"use client";

import { useEffect, useState } from "react";
import { call } from "./client-api";

// The show rail's page pictures for the open card (lib/page-shots.ts): page url → picture src.
// Whenever the pane's page or the thread settles (a new page, a turn that updated the one on screen),
// the page is captured and the list comes back; with no page in the pane, the list is just read.
// The server skips a page it captured moments ago, so a running turn costs a capture every few seconds at most.
type Shots = Record<string, string>;
const NONE: Shots = {};
// Long enough for a page to paint, and for a burst of thread items (a running turn) to pass.
export const SETTLE_MS = 1500;

export function usePageShots(cardId: string | undefined, pageUrl: string, items: number): Shots {
  const [state, setState] = useState<{ card?: string; shots: Shots }>({ shots: NONE });

  useEffect(() => {
    if (!cardId) return;
    const url = `/api/cards/${cardId}/shots`;
    const timer = setTimeout(() => {
      const shots = /^(https?|file):/.test(pageUrl) ? call<{ shots: Shots }>("POST", url, { url: pageUrl }) : call<{ shots: Shots }>("GET", url);
      void shots.then(({ shots }) => setState({ card: cardId, shots })).catch(() => {});
    }, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [cardId, pageUrl, items]);

  return state.card === cardId ? state.shots : NONE;
}
