"use client";

import { useCallback, useEffect, useState } from "react";
import { supabaseBridge, type SupabaseStatus } from "./supabase-view";

// The board folders' Supabase links, from Electron main. Each load asks Supabase, so it loads only while the
// drawer is open: when it opens, when the folders change, and when the window comes back into focus.
export function useSupabase(folders: string[], active: boolean) {
  const bridge = supabaseBridge();
  const [status, setStatus] = useState<SupabaseStatus | null>(null);
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
