// How often the open Services drawer asks for a fresh process list. Like the board prefs
// (lib/board-prefs.ts) it lives in a cookie; 0 pauses it (the list still loads on open and on focus).
const COOKIE = "weft-services-refresh";
const EVENT = "weft-services-refresh";

export const REFRESH_CHOICES = [1000, 2000, 5000, 10_000, 30_000, 0] as const;
export const DEFAULT_REFRESH_MS = 2000;

export function refreshLabel(ms: number) {
  return ms ? `every ${ms / 1000}s` : "paused";
}

export function servicesRefreshMs(): number {
  if (typeof document === "undefined") return DEFAULT_REFRESH_MS;
  const m = new RegExp(`(?:^|; )${COOKIE}=(\\d+)`).exec(document.cookie);
  const ms = m ? Number(m[1]) : DEFAULT_REFRESH_MS;
  return (REFRESH_CHOICES as readonly number[]).includes(ms) ? ms : DEFAULT_REFRESH_MS;
}

export function setServicesRefreshMs(ms: number) {
  document.cookie = `${COOKIE}=${ms}; path=/; max-age=${10 * 365 * 24 * 60 * 60}; SameSite=Lax`;
  window.dispatchEvent(new Event(EVENT));
}

// For useSyncExternalStore.
export function subscribeServicesRefresh(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  return () => window.removeEventListener(EVENT, onChange);
}
