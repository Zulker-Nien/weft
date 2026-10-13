// The weft-desktop bridge for the auth flow. The package's `useAuth` / `useLoginFlow`
// accept a `DesktopAuth` so an Electron shell can run the round trip through the OS
// (signInWithOAuth returns to the system browser, the redirect lands on the shell's
// custom protocol, the shell hands the code back). This is our implementation.
//
// Identical shape to `@aimhuge/auth`'s `DesktopAuth` (we drop the package in here when
// the upstream tag ships).
//
// `weft://account-callback` is registered by Electron main (electron/main.cjs) and
// handled by electron/account-link.cjs, which POSTs the query string to
// `/api/auth/weft-callback`. In plain `next dev` (no Electron) the custom protocol
// isn't registered, so the loopback `http://127.0.0.1:1000/api/auth/callback?next=…`
// is the fallback: the page opens in the system browser, the redirect comes back to
// the dev server, and `createAuthCallback` exchanges the code against the PKCE
// verifier supabase-js kept in the file-based session.
import { weftCallbackUrl } from "../account-callback";

export interface DesktopAuth {
  /** True inside the shell. Called at click time, never during render. */
  isDesktop(): boolean;
  /** The `redirectTo` for a round trip that must land back in the app. */
  redirectTo(next: string): string;
  /** Where the shell lands when the URL has no `?next=`. */
  defaultNext: string;
  /** Where a signed-out shell goes. `useAuth().signOut()` navigates there itself. */
  signedOutPath: string;
  /** Open a URL in the system browser (or a new tab in plain `next dev`). */
  openExternal(url: string): Promise<void>;
}

/**
 * The redirect target for a sign-in round trip.
 *
 * Packaged desktop app (`THREADBOARD_SHELL_URL` set, Electron main running): the
 * `weft://` URL is stable across dev-server port changes (the port is picked at
 * random on every Weft restart). Electron main's `electron/account-link.cjs` parses
 * the link, POSTs the query string to `/api/auth/weft-callback`, and the route
 * exchanges the code against the PKCE verifier kept in the session file.
 *
 * Plain `next dev` (no Electron): fall back to the loopback HTTP origin so the
 * browser's `?next=` round trip works the same way. The dev server is on
 * `127.0.0.1:1000` (electron/free-port.cjs picks 1000) and Supabase's allow-list
 * needs `http://127.0.0.1:1000/**` to accept it.
 */
export function authRedirectTo(next: string, origin?: string): string {
  if (process.env.THREADBOARD_SHELL_URL) {
    const u = new URL(weftCallbackUrl());
    u.searchParams.set("next", next);
    return u.toString();
  }
  // On the server we don't always have `request.headers.get("host")` here, so the
  // caller passes `origin` in. In the browser we read `window.location.origin`.
  const base = origin ?? (typeof window !== "undefined" ? window.location.origin : "");
  return `${base.replace(/\/+$/, "")}/api/auth/callback?next=${encodeURIComponent(next)}`;
}

/**
 * The same redirect target but expressed as the path the system browser should land
 * on after the OAuth round trip. Used when the package / hook needs a same-origin
 * path (e.g. to share cookies with the dev server).
 */
export function authCallbackPath(): string {
  return "/api/auth/callback";
}

/** Open `url` in the system browser, falling back to a new tab in plain `next dev`. */
export function openExternal(url: string): void {
  if (typeof window === "undefined") return;
  // Electron main exposes a token-guarded `openExternal` on the board's window.
  // The same IPC is reused for the account flow (electron/preload.cjs).
  const tb = (window as unknown as { threadboard?: { openExternal?: (u: string) => void } }).threadboard;
  if (tb?.openExternal) {
    tb.openExternal(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

/** True inside the shell (Electron). Read at click time, never during render. */
export function isDesktop(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean((window as unknown as { threadboard?: unknown }).threadboard);
}

/** The single DesktopAuth the auth hook uses. */
export const desktop: DesktopAuth = {
  isDesktop,
  redirectTo: (next) => authRedirectTo(next),
  defaultNext: "/",
  signedOutPath: "/",
  // Wrap to match the async signature the package's `DesktopAuth` expects;
  // a deliberate `await Promise.resolve()` keeps the async signature honest
  // and silences the no-await-in-async lint.
  openExternal: async (url) => {
    openExternal(url);
    await Promise.resolve();
  },
};
