"use client";

import { useState } from "react";

// How wide the side rail's drawer is (components/LibraryRail.tsx): dragged by its edge against the board,
// remembered per browser, back to the default on a double-click.
export const DRAWER_WIDTH = { min: 220, default: 272, max: 640 } as const;
const KEY = "weft.railDrawerWidth";

// A width kept between the bounds and off the last 360px of the window, so the board always shows.
export function clampDrawerWidth(width: number, windowWidth = Infinity) {
  const max = Math.min(DRAWER_WIDTH.max, windowWidth - 360);
  return Math.round(Math.max(DRAWER_WIDTH.min, Math.min(max, width)));
}

export function savedDrawerWidth() {
  try {
    const n = Number(localStorage.getItem(KEY));
    return n ? clampDrawerWidth(n) : DRAWER_WIDTH.default;
  } catch {
    return DRAWER_WIDTH.default;
  }
}

function saveDrawerWidth(width: number) {
  try {
    localStorage.setItem(KEY, String(width));
  } catch {}
}

export function useDrawerWidth() {
  const [width, setWidth] = useState(() => (typeof window === "undefined" ? DRAWER_WIDTH.default : savedDrawerWidth()));

  function startDrag(e: React.PointerEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;
    let last = width;
    const { cursor, userSelect } = document.body.style;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const move = (ev: PointerEvent) => {
      last = clampDrawerWidth(startWidth + ev.clientX - startX, window.innerWidth);
      setWidth(last);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.cursor = cursor;
      document.body.style.userSelect = userSelect;
      saveDrawerWidth(last);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function reset() {
    setWidth(DRAWER_WIDTH.default);
    saveDrawerWidth(DRAWER_WIDTH.default);
  }

  return { width, startDrag, reset };
}
