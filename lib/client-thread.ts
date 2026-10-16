// Folds live thread items received while a thread snapshot is loading on top of it.

import type { ThreadItem } from "./types";

// A thread snapshot with the live items that arrived while it loaded, which are newer than it.
export function mergeThread(snapshot: ThreadItem[], live: (ThreadItem | undefined)[]): ThreadItem[] {
  const next = snapshot.slice();
  live.forEach((item, i) => {
    if (item) next[i] = item;
  });
  return next;
}
