"use client";

import { useEffect } from "react";
import type { StartupResult } from "./client";

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

// What the toast says after a slow launch, naming the phase that took longest.
export function slowStartupMessage(result: StartupResult): string | null {
  if (!result.slow || result.usual === null) return null;
  const { label, ms } = result.slowest;
  return `Weft took ${seconds(result.total)} to start (usually ${seconds(result.usual)}). Slowest: ${label}, ${seconds(ms)}.`;
}

// Once the board's first cards are on screen, tells the desktop shell, which times the launch
// (electron/startup-timer.cjs); a launch well over the usual time shows a toast.
export function useStartupCheck(loaded: boolean, toast: (text: string) => void) {
  useEffect(() => {
    if (!loaded) return;
    void window.weft
      ?.startupReady?.()
      .then((result) => {
        const message = slowStartupMessage(result);
        if (message) toast(message);
      })
      .catch(() => {});
  }, [loaded, toast]);
}
