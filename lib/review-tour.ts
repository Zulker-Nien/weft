import type { ThreadItem } from "./types";

// Helpers for the review tour shown by components/ReviewPanel.tsx: which local URL the thread
// talked about most, with Weft's own address filtered out (the user is reading Weft, not a card's
// app, when they have weboard at the same origin).

const LOCAL_URL = /https?:\/\/(?:localhost|127\.0\.0\.1):\d+/g;

// The local app the thread talked about most (its dev server), as the address of its home page.
// The newest mention is a worse guess: threads end on API calls and throwaway test servers.
export function lastLocalUrl(items: ThreadItem[]): string | undefined {
  const counts = new Map<string, number>();
  for (const item of items) {
    const text = item.kind === "assistant" ? item.text : item.kind === "tool" ? `${item.summary} ${item.result ?? ""}` : "";
    for (const origin of text.match(LOCAL_URL) ?? []) counts.set(origin, (counts.get(origin) ?? 0) + 1);
  }
  // Weft's own address isn't the card's app, even when the card is working on Weft.
  const self = typeof window === "undefined" ? "" : window.location.origin.replace("localhost", "127.0.0.1");
  let best: string | undefined;
  for (const [origin, n] of counts) {
    if (origin.replace("localhost", "127.0.0.1") === self) continue;
    if (!best || n >= (counts.get(best) ?? 0)) best = origin;
  }
  return best && `${best}/`;
}