"use client";

import { useEffect, useRef } from "react";
import { followUrl, type Mini } from "./show-rail";

// Once the chat stops scrolling, wait this long before moving the pane, so a fling through the
// thread doesn't load every page on the way.
export const FOLLOW_MS = 350;

// The browser pane follows the chat (docs/architecture/show-rail.md): scroll the chat and, once it
// settles, the pane shows the page that was on screen for the turn at its top. Back at the end of
// the chat, the pane returns to the newest page, but only if following moved it: a page Weft opened
// itself (the starter or update page) isn't in the thread and stays put. reopen opens a page without
// counting it as a visit.
export function usePaneFollow(minis: Mini[], pageUrl: string, reopen: (url: string) => void) {
  const latest = useRef({ minis, pageUrl, reopen });
  useEffect(() => {
    latest.current = { minis, pageUrl, reopen };
  });
  const moved = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  return (id: string, bottom: boolean) => {
    clearTimeout(timer.current);
    if (bottom && !moved.current) return;
    timer.current = setTimeout(() => {
      const now = latest.current;
      const url = followUrl(now.minis, id, bottom, now.pageUrl);
      moved.current = !bottom;
      if (url) now.reopen(url);
    }, FOLLOW_MS);
  };
}
