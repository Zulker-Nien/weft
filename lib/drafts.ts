// Unsent text kept in localStorage, so closing a thread (Escape) or reloading doesn't lose it.
// Storage can be missing or full; a draft is never worth an error.

export function readDraft(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

// Empty text removes the draft.
export function writeDraft(key: string, markdown: string) {
  try {
    if (markdown.trim()) localStorage.setItem(key, markdown);
    else localStorage.removeItem(key);
  } catch {}
}

// What you were typing to a thread in its reply box.
export const replyDraftKey = (cardId: string) => `weft.reply.${cardId}`;

// Moves one draft onto the end of another and returns the result, e.g. the reply box's text into a review
// step's feedback box when the tour takes the reply box's place. Nothing to move returns "".
export function moveDraft(from: string, to: string): string {
  const moving = readDraft(from);
  if (!moving.trim()) return "";
  const there = readDraft(to);
  const merged = there.trim() ? `${there.trimEnd()}\n\n${moving}` : moving;
  writeDraft(to, merged);
  writeDraft(from, "");
  return merged;
}
