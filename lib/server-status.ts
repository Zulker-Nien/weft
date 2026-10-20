"use client";

import { useEffect, useState } from "react";

// The dev server supervisor pushes "server:fatal" once its 4-in-2-min crash budget trips while the
// board is up (electron/server.cjs → electron/main.cjs → preload.cjs → here). We read the bridge
// lazily inside useEffect so the import doesn't crash when this module is loaded server-side, the
// same way lib/build-error.ts reads `document` only on the client. The bar that uses this is
// components/ServerErrorBar.tsx; it renders a Restart / Open logs / Fix-with-a-thread button row.

export type ServerFatal = { message: string };

function bridge(): { onFatal: (cb: (fatal: ServerFatal) => void) => () => void; onStatus: (cb: (text: string) => void) => () => void; retry: () => Promise<{ ok: boolean }>; logTail: () => Promise<string>; openLogs: () => Promise<void>; createFixCard: () => Promise<void> } | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { weft?: { server?: ReturnType<typeof bridge> } };
  return w.weft?.server ?? null;
}

/** The most recent server:fatal push, or null. Subscribes in a useEffect so SSR is safe. */
export function useServerFatal() {
  const [fatal, setFatal] = useState<ServerFatal | null>(null);
  useEffect(() => {
    const b = bridge();
    if (!b) return;
    return b.onFatal((next) => setFatal(next));
  }, []);
  return fatal;
}

/** "Restarting…" / "Ready" pushes from the supervisor. The bar shows it while a manual retry runs. */
export function useServerStatus() {
  const [status, setStatus] = useState<string | null>(null);
  useEffect(() => {
    const b = bridge();
    if (!b) return;
    return b.onStatus((text) => setStatus(text));
  }, []);
  return status;
}
