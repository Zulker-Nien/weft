"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { BrowserState } from "./client";
import type { Card } from "./types";

const noopSubscribe = () => () => {};

// The board's side of the Electron preload bridge (window.threadboard): whether it's there at all, the
// browser pane's and copilot window's state, and keeping each card's browser and the dock badge in step
// with the board. In a plain browser tab it reports `closed` and does nothing.
export function useDesktopBridge(closed: BrowserState, selectedId: string | null, cards: Card[]) {
  const [browser, setBrowser] = useState<BrowserState>(closed);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const desktop = useSyncExternalStore(noopSubscribe, () => Boolean(window.threadboard), () => false);
  // On macOS the header doubles as the title bar, under the window's traffic lights.
  const mac = useSyncExternalStore(noopSubscribe, () => window.threadboard?.platform ?? "", () => "") === "darwin";

  useEffect(() => {
    const bridge = window.threadboard;
    if (!bridge) return;
    void bridge.browser.getState().then(setBrowser);
    const offBrowser = bridge.browser.onState(setBrowser);
    const offCopilot = bridge.copilot.onState((state) => setCopilotOpen(state.open));
    return () => {
      offBrowser();
      offCopilot();
    };
  }, []);

  // Each card has its own browser: show the open card's, and close those of cards that are gone.
  useEffect(() => {
    window.threadboard?.browser.setActive(selectedId);
  }, [selectedId]);

  useEffect(() => {
    if (cards.length) window.threadboard?.browser.prune(cards.map((c) => c.id));
  }, [cards]);

  useEffect(() => {
    window.threadboard?.setBadge(cards.filter((c) => c.column === "needs_you").length);
  }, [cards]);

  return { desktop, mac, browser, copilotOpen };
}
