"use client";

import { useSyncExternalStore } from "react";

// The clock for "5m ago" labels. It reads 0 during prerender, where the current time isn't allowed,
// and starts ticking once the board is in the browser.
let clock = 0;
function subscribeClock(onTick: () => void) {
  clock = Date.now();
  const timer = setInterval(() => {
    clock = Date.now();
    onTick();
  }, 30_000);
  return () => clearInterval(timer);
}

export function useNow() {
  return useSyncExternalStore(subscribeClock, () => clock, () => 0);
}
