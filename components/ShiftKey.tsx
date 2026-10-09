"use client";

import { useEffect, useState } from "react";
import { isTyping } from "@/lib/hotkeys";

// A Shift key cap in the bottom-left corner while Shift is held, so Shift shortcuts (like ⇧A) feel armed.
// Stays hidden while you type, where Shift just makes capitals.
export default function ShiftKey() {
  const [held, setHeld] = useState(false);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "Shift") setHeld(!isTyping(e.target));
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === "Shift") setHeld(false);
    };
    const reset = () => setHeld(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", reset);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", reset);
    };
  }, []);

  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none fixed bottom-10 left-3 z-50 transition-all duration-150 ${
        held ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"
      }`}
    >
      <kbd className="flex items-center gap-1.5 rounded-md border border-line-strong border-b-[3px] bg-panel px-2.5 py-1 font-mono text-[12px] text-ink shadow-md">
        <span className="text-[14px] leading-none">⇧</span>
        shift
      </kbd>
    </div>
  );
}
