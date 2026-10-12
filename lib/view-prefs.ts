// The board's selected project and sort order, so the next launch opens where you left off. They live in a
// cookie rather than localStorage because the desktop app's server can land on a different port, and each
// port is its own localStorage (lib/theme.ts hit the same thing). The old localStorage copy is still read
// as a fallback, so a project picked before this moved comes back once. Read in the browser, not in
// app/page.tsx: a server-side cookie read would make the board's prerendered shell dynamic and slow its
// first draw.
import type { SortKey } from "./board-view";

export type ViewPrefs = { project?: string | null; sort?: SortKey };

export const VIEW_COOKIE = "weft-view";
const LEGACY_KEY = "threadboard.view";

function parse(text: string | null | undefined): ViewPrefs | null {
  if (!text) return null;
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

function fromCookie(): ViewPrefs | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${VIEW_COOKIE}=([^;]*)`));
  const text = match?.[1];
  if (!text) return null;
  try {
    return parse(decodeURIComponent(text));
  } catch {
    return null;
  }
}

function fromLocalStorage(): ViewPrefs | null {
  try {
    return parse(localStorage.getItem(LEGACY_KEY));
  } catch {
    return null;
  }
}

export function readViewPrefs(): ViewPrefs {
  return fromCookie() ?? fromLocalStorage() ?? {};
}

export function writeViewPrefs(prefs: { project: string | null; sort: SortKey }) {
  const value = encodeURIComponent(JSON.stringify(prefs));
  document.cookie = `${VIEW_COOKIE}=${value}; path=/; max-age=${10 * 365 * 24 * 60 * 60}; SameSite=Lax`;
}
