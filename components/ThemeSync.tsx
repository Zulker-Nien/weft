"use client";

import { useLayoutEffect } from "react";
import { DARK_QUERY, applyTheme } from "@/lib/theme";

// Keeps <html data-theme> right after the head script sets it: React's dev remount clears the
// attribute, and "System" has to follow the OS when it switches.
export default function ThemeSync() {
  useLayoutEffect(() => {
    applyTheme();
    const media = matchMedia(DARK_QUERY);
    media.addEventListener("change", applyTheme);
    return () => media.removeEventListener("change", applyTheme);
  }, []);
  return null;
}
