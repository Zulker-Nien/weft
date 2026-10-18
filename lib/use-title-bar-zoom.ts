"use client";

import { useEffect } from "react";

// macOS draws the traffic lights in window pixels, but the page zooms (View > Zoom In/Out), so a
// header sized in CSS pixels shrinks under them when zoomed out. This keeps `--zoom` on the root
// current, so title-bar sizes written as `calc(78px / var(--zoom))` stay put on screen. A zoom
// change resizes the page's viewport, so `resize` is when to read it again.
export function useTitleBarZoom() {
  useEffect(() => {
    const bridge = window.weft;
    if (!bridge?.zoomFactor) return;
    const apply = () => document.documentElement.style.setProperty("--zoom", String(bridge.zoomFactor?.() || 1));
    apply();
    window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
  }, []);
}
