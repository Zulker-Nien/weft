// Board layout choices from Settings. Like the theme (lib/theme.ts) they live in a cookie, since the
// desktop server's port can change. Changes fire an event so the board updates without a reload.
const BACKLOG_COOKIE = "weft-show-backlog";
const EVENT = "weft-board-prefs";

// Off by default: cards start right away, so the Backlog column is usually empty.
export function showBacklog(): boolean {
  if (typeof document === "undefined") return false;
  return new RegExp(`(?:^|; )${BACKLOG_COOKIE}=1`).test(document.cookie);
}

export function setShowBacklog(on: boolean) {
  document.cookie = `${BACKLOG_COOKIE}=${on ? 1 : 0}; path=/; max-age=${10 * 365 * 24 * 60 * 60}; SameSite=Lax`;
  window.dispatchEvent(new Event(EVENT));
}

// For useSyncExternalStore.
export function subscribeBoardPrefs(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  return () => window.removeEventListener(EVENT, onChange);
}
