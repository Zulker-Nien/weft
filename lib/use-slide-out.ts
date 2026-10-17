"use client";

import { useEffect, useState } from "react";

// Keeps a panel drawn while it slides away: `shown` is what to draw (the open panel, or the one that just closed
// for `ms` more), `closing` is true for that last stretch so its CSS can play the slide back. Used by the side
// rail's drawers (components/LibraryRail.tsx), which slide out from under the board and back beneath it.
export function useSlideOut<T>(open: T | null, ms: number): { shown: T | null; closing: boolean } {
  const [last, setLast] = useState<T | null>(open);
  // Remember the latest open panel during render, so a switch from one drawer to another draws the new one at once.
  if (open !== null && open !== last) setLast(open);
  const closing = open === null && last !== null;
  useEffect(() => {
    if (!closing) return;
    const timer = setTimeout(() => setLast(null), ms);
    return () => clearTimeout(timer);
  }, [closing, ms]);
  return { shown: open ?? last, closing };
}
