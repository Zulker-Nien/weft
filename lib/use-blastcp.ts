"use client";

import { useCallback, useEffect, useState } from "react";
import { blastcpBridge, type BlastcpStatus } from "./blastcp-view";

// The board folders' BlastCP properties, from Electron main. Each load asks BlastCP, so it loads only while
// the BlastCP drawer is open: when it opens, when the folders change, and when the window comes back into focus.
export function useBlastcp(folders: string[], active: boolean) {
  const bridge = blastcpBridge();
  const [status, setStatus] = useState<BlastcpStatus | null>(null);
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
