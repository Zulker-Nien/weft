import { useEffect, useSyncExternalStore } from "react";

// Full-window overlays opened deep in the tree (an image opened full size). The browser pane is a native
// view drawn above the page, so it hides while any of these is up.
let open = 0;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function change(by: number) {
  open += by;
  for (const listener of listeners) listener();
}

// Counts this overlay as covering the window while `active`.
export function useOverlay(active: boolean) {
  useEffect(() => {
    if (!active) return;
    change(1);
    return () => change(-1);
  }, [active]);
}

// Whether any overlay is up.
export function useAnyOverlay(): boolean {
  return useSyncExternalStore(subscribe, () => open > 0, () => false);
}
