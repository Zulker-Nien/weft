"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "./client";
import type { AccountProvider, AccountView } from "./types";

// Your Weft account on the board side: the top bar's sign-in button and Settings → Weft account
// both use this. Any instance that sees a change tells the others with a window event, and the board
// fires it too when the server says the account changed (BoardEvent "account").

// While sign-in finishes in the browser, check this often, for as long as a sign-in code lasts.
export const POLL_MS = 2000;
export const WAIT_MS = 5 * 60 * 1000;
export const ACCOUNT_EVENT = "weft:account";

export const PROVIDER_LABELS: Record<AccountProvider, string> = { github: "GitHub", google: "Google" };

export type AccountBusy = AccountProvider | "email" | "signout" | null;
export type AccountState = { kind: "loading" } | { kind: "error"; error: string } | { kind: "ready"; view: AccountView };
// What the browser is finishing: a provider's name, or the address a link went to.
export interface AccountWaiting {
  what: string;
  email: boolean;
  since: number;
}

function message(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

function openUrl(url: string) {
  if (window.threadboard) window.threadboard.openExternal(url);
  else window.open(url, "_blank", "noopener,noreferrer");
}

export function announceAccountChange() {
  window.dispatchEvent(new Event(ACCOUNT_EVENT));
}

export function useAccount() {
  const [state, setState] = useState<AccountState>({ kind: "loading" });
  const [busy, setBusy] = useState<AccountBusy>(null);
  const [waiting, setWaiting] = useState<AccountWaiting | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      api.account().then(
        (view) => {
          setState({ kind: "ready", view });
          if (view.user) setWaiting(null);
          return view;
        },
        (err: unknown) => {
          setState({ kind: "error", error: message(err) });
          return null;
        },
      ),
    [],
  );

  useEffect(() => {
    void load();
    const reload = () => void load();
    window.addEventListener(ACCOUNT_EVENT, reload);
    return () => window.removeEventListener(ACCOUNT_EVENT, reload);
  }, [load]);

  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => {
      if (Date.now() - waiting.since > WAIT_MS) {
        setWaiting(null);
        return;
      }
      void load().then((view) => {
        if (view?.user) announceAccountChange();
      });
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [waiting, load]);

  async function run(kind: Exclude<AccountBusy, null>, action: () => Promise<void>) {
    setBusy(kind);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(null);
    }
  }

  // Opens the provider in the system browser; the sign-in comes back to this machine's server.
  const signIn = (provider: AccountProvider) =>
    run(provider, async () => {
      const { url } = await api.signIn(provider);
      openUrl(url);
      setWaiting({ what: PROVIDER_LABELS[provider], email: false, since: Date.now() });
    });

  const sendLink = (email: string) =>
    run("email", async () => {
      await api.magicLink(email);
      setWaiting({ what: email.trim(), email: true, since: Date.now() });
    });

  const signOut = () =>
    run("signout", async () => {
      await api.signOut();
      announceAccountChange();
    });

  return { state, busy, waiting, error, signIn, sendLink, signOut };
}
