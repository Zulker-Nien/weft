import type { ThreadItem } from "./types";

// Helpers for the review tour shown by components/ReviewPanel.tsx: which local URL the thread
// talked about most, with Weft's own address filtered out (the user is reading Weft, not a card's
// app, when they have weboard at the same origin).

const LOCAL_URL = /https?:\/\/(?:localhost|127\.0\.0\.1):\d+/g;

// What a thread item says about where its app is: the thread's own words and the pages it opened in
// the pane. Not other tools' output: a grep or a test run lists every address in the code (Weft's own
// tests use a fake http://127.0.0.1:4567), and the most-mentioned one would open a dead port.
function mentions(item: ThreadItem): string {
  if (item.kind === "assistant") return item.text;
  if (item.kind === "tool" && item.name.endsWith("browser__open_url")) return item.summary;
  return "";
}

// The local app the thread talked about most (its dev server), as the address of its home page.
// The newest mention is a worse guess: threads end on API calls and throwaway test servers.
export function lastLocalUrl(items: ThreadItem[]): string | undefined {
  const counts = new Map<string, number>();
  for (const item of items) {
    const text = mentions(item);
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