import { isLive } from "./format";
import type { Card, ThreadItem } from "./types";

// Why only the open thread shows the rerun banner (lib/components/FirstMessageErrorBanner.tsx):
// the "first message failed" case is the only one where rerunning on a different model
// actually helps. A later turn failing in the same card already has progress — Continue /
// Restart cover it (lib/card-resume.ts). This predicate is the single source of truth:
// the banner renders, the ThreadView test asserts against it.
export function firstMessageFailed(card: Card, items: readonly (ThreadItem | null | undefined)[]): boolean {
  if (!card.error || isLive(card)) return false;
  // Exactly one user message in the thread (the original prompt).
  const users = items.filter((i): i is Extract<ThreadItem, { kind: "user" }> => i?.kind === "user");
  if (users.length !== 1) return false;
  // No assistant text after it: the turn produced nothing useful (an error result, a tool
  // call that didn't finish, or nothing at all).
  return !items.some((i) => i?.kind === "assistant" && i.text.trim());
}

