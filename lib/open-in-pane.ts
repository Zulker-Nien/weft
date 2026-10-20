import { openExternal } from "@/lib/auth/desktop";
import type { ShellBridge } from "@/lib/client";

// A web page in the board's browser pane (where you're signed in to dashboards), else the system browser.
export function openInPane(url: string) {
  if (typeof window === "undefined") return;
  // Partial: a shell from before the pane has no browser bridge, so this falls back to the system browser.
  const pane: Partial<ShellBridge["browser"]> | undefined = window.weft?.browser;
  if (pane?.open) {
    void pane.open(url, "board").catch(() => openExternal(url));
    return;
  }
  openExternal(url);
}
