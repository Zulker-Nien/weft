"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { IDLE_LOCK_MS, vaultBridge, type SecretAsk, type VaultOverview } from "./vault-view";

// The vaults of the board's folders, from Electron main. Loads again when the folders change and when
// the window comes back into focus, so the rail's nudge notices a .env.local edited in another app.
export function useVault(folders: string[]) {
  const bridge = vaultBridge();
  const [overview, setOverview] = useState<VaultOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = folders.join("\n");

  const reload = useCallback(() => (bridge && key ? show(bridge.overview(key.split("\n")), setOverview, setError) : Promise.resolve()), [bridge, key]);

  useEffect(() => {
    if (!bridge || !key) return;
    const load = () => void show(bridge.overview(key.split("\n")), setOverview, setError);
    load();
    window.addEventListener("focus", load);
    // A hand edit to a managed .env.local, from main's watcher.
    const stop = bridge.onChange?.(load);
    return () => {
      window.removeEventListener("focus", load);
      stop?.();
    };
  }, [bridge, key]);

  return { bridge, overview, error, reload };
}

// ⇧S, the palette's Add a secret, and a thread asking for a key (ask: the name to fill in, from main's
// "add-secret" message): open the 🔐 drawer and ask it for its Add form. The drawer may not be open yet, or
// still loading its vaults, so the ask waits for a taker (onSecretAsk) that can serve it.
type Taker = (ask?: SecretAsk) => boolean;
let pending: { ask?: SecretAsk } | null = null;
let secretTaker: Taker | null = null;

export function addSecret(openDrawer: (panel: "vault") => void, ask?: SecretAsk) {
  openDrawer("vault");
  pending = secretTaker?.(ask) ? null : { ask };
}

// The drawer's taker opens its Add form and says whether it could; the returned function unsubscribes.
export function onSecretAsk(take: Taker): () => void {
  secretTaker = take;
  if (pending && take(pending.ask)) pending = null;
  return () => {
    if (secretTaker === take) secretTaker = null;
  };
}

function show(load: Promise<VaultOverview>, setOverview: (o: VaultOverview) => void, setError: (e: string | null) => void) {
  return load.then(
    (overview) => {
      setOverview(overview);
      setError(null);
    },
    (err: unknown) => setError(err instanceof Error ? err.message : String(err)),
  );
}

// Calls onIdle once nothing has been clicked or typed for ms while active; any input starts the wait over.
export function useIdle(active: boolean, onIdle: () => void, ms = IDLE_LOCK_MS) {
  const latest = useRef(onIdle);
  useEffect(() => {
    latest.current = onIdle;
  });
  useEffect(() => {
    if (!active) return;
    let timer = setTimeout(() => latest.current(), ms);
    const restart = () => {
      clearTimeout(timer);
      timer = setTimeout(() => latest.current(), ms);
    };
    window.addEventListener("pointerdown", restart);
    window.addEventListener("keydown", restart);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("pointerdown", restart);
      window.removeEventListener("keydown", restart);
    };
  }, [active, ms]);
}
