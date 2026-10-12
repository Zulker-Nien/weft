"use client";

import { useCallback, useEffect, useState } from "react";

// A rail drawer's status from Electron main (▲ Vercel, Supabase, BlastCP), kept between opens and restarts.
// Each load asks the service, so it loads only while the drawer is open: when it opens, when the folders change,
// and when the window comes back into focus, but no more than once per FRESH_MS. Until the first answer the
// drawer shows the last one it had (in memory, then localStorage), so it opens straight away instead of on
// "Asking Vercel…". The statuses hold names and links, never a token: main keeps those in the Keychain.
export const FRESH_MS = 30_000;

type Bridge<S> = { status(folders: string[]): Promise<S> };
type Entry<S> = { key: string; status: S; at: number };

const memory = new Map<string, Entry<unknown>>();
const storageKey = (name: string) => `weft:drawer-status:${name}`;

function cached<S>(name: string): Entry<S> | null {
  const hit = memory.get(name);
  if (hit) return hit as Entry<S>;
  try {
    const raw = localStorage.getItem(storageKey(name));
    // From an earlier run: shown, but never fresh enough to skip asking again.
    return raw ? { ...(JSON.parse(raw) as Entry<S>), at: 0 } : null;
  } catch {
    return null;
  }
}

function remember<S>(name: string, entry: Entry<S>) {
  memory.set(name, entry);
  try {
    localStorage.setItem(storageKey(name), JSON.stringify(entry));
  } catch {
    // Storage full or off: the memory copy still covers this run.
  }
}

// Forget every cached status (tests).
export function clearLinkedStatusCache() {
  memory.clear();
}

export function useLinkedStatus<B extends Bridge<unknown>>(name: string, bridge: B | null, folders: string[], active: boolean) {
  type S = Awaited<ReturnType<B["status"]>>;
  const [status, setStatus] = useState<S | null>(() => cached<S>(name)?.status ?? null);
  const [error, setError] = useState<string | null>(null);
  const key = folders.join("\n");

  const reload = useCallback(
    () =>
      bridge && key
        ? (bridge.status(key.split("\n")) as Promise<S>).then(
            (s: S) => {
              remember(name, { key, status: s, at: Date.now() });
              setStatus(s);
              setError(null);
            },
            (err: unknown) => setError(err instanceof Error ? err.message : String(err)),
          )
        : Promise.resolve(),
    [bridge, key, name],
  );

  useEffect(() => {
    if (!active) return;
    const load = () => {
      const last = cached<S>(name);
      if (!last || last.key !== key || Date.now() - last.at >= FRESH_MS) void reload();
    };
    load();
    window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
  }, [active, reload, name, key]);

  return { bridge, status, error, reload };
}
