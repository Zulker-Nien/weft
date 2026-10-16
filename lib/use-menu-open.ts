"use client";

// Watches an open/close state for a menu: closes on outside mousedown, calls the caller when it opens
// or closes (so the board can hide a native browser overlay while the menu is up), and fires the
// close callback on unmount if the menu is still open.
import { useEffect, useEffectEvent, type RefObject } from "react";

export function useMenuOpen({
  open,
  setOpen,
  onOpenChange,
  menuRef,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  // The caller learns the menu's open state (true while the effect is mounted).
  onOpenChange?: (open: boolean) => void;
  menuRef: RefObject<HTMLElement | null>;
}) {
  const close = useEffectEvent(() => setOpen(false));
  const report = useEffectEvent((isOpen: boolean) => onOpenChange?.(isOpen));

  useEffect(() => {
    if (!open) return;
    report(true);
    const onMouseDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) close();
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      report(false);
    };
  }, [open, menuRef]);
}
