"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { Card } from "./types";
import { columnCounts, loadSeen, markSeen, nextTip, TIPS_CHANGED, TIPS_KEY, type TipId } from "./tips";

// The board's onboarding after the welcome (components/OnboardingTips.tsx): which coach tip shows (lib/tips.ts)
// and whether the empty board's start panel does. Nothing shows until the board has loaded; the start panel
// also waits out a filter, which can empty the board without it being new.

function subscribe(fn: () => void) {
  window.addEventListener(TIPS_CHANGED, fn);
  return () => window.removeEventListener(TIPS_CHANGED, fn);
}
const readSeen = () => {
  try {
    return localStorage.getItem(TIPS_KEY) ?? "[]";
  } catch {
    return "[]";
  }
};
// On the server every tip counts as seen, so none flashes in before the real set is read.
const serverSeen = () => null;

export function useOnboardingTips(cards: readonly Card[], loaded: boolean, filtering: boolean) {
  const raw = useSyncExternalStore(subscribe, readSeen, serverSeen);
  const seen = useMemo(() => (raw === null ? null : loadSeen()), [raw]);
  const counts = useMemo(() => columnCounts(cards), [cards]);
  const tip = loaded && seen ? nextTip(counts, seen) : null;
  const empty = loaded && !filtering && seen !== null && Object.keys(counts).length === 0;
  const dismiss = useCallback((id: TipId) => {
    markSeen(id);
    window.dispatchEvent(new Event(TIPS_CHANGED));
  }, []);
  return { tip, empty, dismiss };
}
