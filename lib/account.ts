import fs from "node:fs";
import path from "node:path";
import { createClient, type User } from "@supabase/supabase-js";
import { shellStorage } from "./account-storage";
import { publish } from "./bus";
import { globalSingleton } from "./global-singleton";
import { shellToken } from "./shell-token";
import { DATA_DIR } from "./store";
import type { AccountProvider, AccountUser, AccountView } from "./types";

// A Weft account is optional: the board works signed out, and signing in unlocks cloud features
// (page sync, share links). Sign-in runs in the system browser and comes back to this machine: as
// weft://account-callback in the desktop app, or the loopback /api/account/callback in plain `next dev`
// (see redirectUrl). PKCE keeps the code verifier in the session file, so the link only works on the
// machine that started the sign-in.

// Weft prod. The publishable key is safe to ship in the app; row-level security guards the data.
// WEFT_SUPABASE_KEY="" turns accounts off.
export const SUPABASE_URL = process.env.WEFT_SUPABASE_URL || "https://lqjyravglujyizyqypxq.supabase.co";
export const SUPABASE_KEY = process.env.WEFT_SUPABASE_KEY ?? "sb_publishable_DHNc-IYsRJSJkbN38qZNLQ_G59w6uVe";
export const CALLBACK_PATH = "/api/account/callback";
const SESSION_FILE = path.join(DATA_DIR, "account.json");

export const PROVIDERS: AccountProvider[] = ["github", "google"];

// supabase-js storage backed by one JSON file, readable only by you: it holds the refresh token.
export const fileStorage = {
  read(): Record<string, string> {
    try {
      return JSON.parse(fs.readFileSync(SESSION_FILE, "utf8")) as Record<string, string>;
    } catch {
      return {};
    }
  },
  write(data: Record<string, string>) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SESSION_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
  },
  getItem(key: string): string | null {
    return fileStorage.read()[key] ?? null;
  },
  setItem(key: string, value: string) {
    fileStorage.write({ ...fileStorage.read(), [key]: value });
  },
  removeItem(key: string) {
    fileStorage.write(Object.fromEntries(Object.entries(fileStorage.read()).filter(([k]) => k !== key)));
  },
};

function client() {
  if (!SUPABASE_KEY) throw new Error("Weft accounts aren't set up in this build yet.");
  return globalSingleton("__weftSupabase", () =>
    createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: {
        flowType: "pkce",
        // In the desktop app Electron main keeps the session sealed in the Keychain (electron/account-store.cjs).
        storage: process.env.THREADBOARD_SHELL_URL ? shellStorage(process.env.THREADBOARD_SHELL_URL, shellToken()) : fileStorage,
        storageKey: "weft-auth",
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    }),
  );
}

export function toAccountUser(user: User): AccountUser {
  const meta: Record<string, unknown> = user.user_metadata;
  const pick = (...keys: string[]) => keys.map((k) => meta[k]).find((v): v is string => typeof v === "string" && v !== "") ?? null;
  return {
    id: user.id,
    email: user.email ?? null,
    name: pick("full_name", "name", "user_name"),
    avatar: pick("avatar_url", "picture"),
    provider: typeof user.app_metadata.provider === "string" ? user.app_metadata.provider : null,
  };
}

function changed() {
  publish({ type: "account" });
}

export async function accountView(): Promise<AccountView> {
  if (!SUPABASE_KEY) return { configured: false, user: null };
  // getSession reads the file and refreshes an expired token; it doesn't call the server otherwise.
  const { data } = await client().auth.getSession();
  return { configured: true, user: data.session ? toAccountUser(data.session.user) : null };
}

// The custom URL scheme the desktop app registers as the OAuth redirect target, so the URL is
// stable across dev server port changes (the port is picked at random on every Weft restart).
// In packaged builds the OS hands weft://account-callback back to Electron's main process, which
// forwards the code to /api/account/weft-callback. In plain `next dev` (no Electron) the scheme
// is not registered, so we fall back to the HTTP loopback.
export const ACCOUNT_CALLBACK_HOST = "account-callback";
export function weftCallbackUrl(): string {
  return `${WEEFT_PROTOCOL}://${ACCOUNT_CALLBACK_HOST}`;
}

// Where Supabase sends the browser back to. The packaged desktop app uses the weft:// scheme so
// the URL doesn't depend on the dev port; plain `next dev` uses the loopback HTTP origin instead.
export const WEEFT_PROTOCOL = "weft";
export function redirectUrl(origin: string): string {
  if (process.env.THREADBOARD_SHELL_URL) return weftCallbackUrl();
  return `${origin.replace(/\/+$/, "")}${CALLBACK_PATH}`;
}

// The provider's sign-in page, for the board to open in the system browser.
export async function startSignIn(provider: AccountProvider, origin: string): Promise<string> {
  if (!PROVIDERS.includes(provider)) throw new Error("Unknown sign-in provider.");
  const { data, error } = await client().auth.signInWithOAuth({
    provider,
    options: { redirectTo: redirectUrl(origin), skipBrowserRedirect: true },
  });
  if (error) throw error;
  if (!data.url) throw new Error("Supabase didn't return a sign-in page.");
  return data.url;
}

export async function sendMagicLink(email: string, origin: string): Promise<void> {
  const address = email.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw new Error("Enter a valid email address.");
  const { error } = await client().auth.signInWithOtp({
    email: address,
    options: { emailRedirectTo: redirectUrl(origin), shouldCreateUser: true },
  });
  if (error) throw error;
}

// The code from /api/account/callback?code=…; it's good for 5 minutes and only once.
export async function finishSignIn(code: string): Promise<AccountUser> {
  if (!code) throw new Error("The sign-in link had no code. Try signing in again.");
  const { data, error } = await client().auth.exchangeCodeForSession(code);
  if (error) throw error;
  changed();
  return toAccountUser(data.user);
}

export async function signOut(): Promise<void> {
  // Local scope: signing out here leaves your other devices signed in.
  const { error } = await client().auth.signOut({ scope: "local" });
  if (error) throw error;
  changed();
}
