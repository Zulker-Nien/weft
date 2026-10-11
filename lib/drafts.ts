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
