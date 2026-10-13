"use client";

import { useCallback, useState } from "react";
import { api } from "./client";
import type { RestartStatus } from "./types";

// The board's view of restart when idle (lib/restart-when-idle.ts): `reload` on every event-stream (re)connect, and
// `apply` for each "restart" event in between.
export function useRestart() {
  const [restart, setRestart] = useState<RestartStatus | null>(null);
  const reload = useCallback(() => {
    api.restartStatus().then(setRestart, () => {});
  }, []);
  return { restart, apply: setRestart, reload };
}
