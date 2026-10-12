"use client";

import { useCallback, useEffect, useState } from "react";
import { vercelBridge, type VercelStatus } from "./vercel-view";

// The board folders' Vercel links, from Electron main. Each load asks Vercel, so it loads only while the
// ▲ drawer is open: when it opens, when the folders change, and when the window comes back into focus.
export function useVercel(folders: string[], active: boolean) {
  const bridge = vercelBridge();
  const [status, setStatus] = useState<VercelStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = folders.join("\n");

  const reload = useCallback(
    () =>
      bridge && key
        ? bridge.status(key.split("\n")).then(
            (s) => {
              setStatus(s);
              setError(null);
            },
            (err: unknown) => setError(err instanceof Error ? err.message : String(err)),
          )
        : Promise.resolve(),
    [bridge, key],
  );

  useEffect(() => {
    if (!active) return;
    void reload();
    const load = () => void reload();
    window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
  }, [active, reload]);

  return { bridge, status, error, reload };
}
