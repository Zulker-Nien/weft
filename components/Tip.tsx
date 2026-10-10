"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// A hover bubble above its child, kept inside the window. Native title tooltips don't show in the
// desktop app, so this draws its own, in a portal so no panel or dialog can clip it.
export default function Tip({ text, children }: { text: React.ReactNode; children: React.ReactNode }) {
  const trigger = useRef<HTMLSpanElement>(null);
  const bubble = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !trigger.current || !bubble.current) return setPos(null);
    const t = trigger.current.getBoundingClientRect();
    const b = bubble.current.getBoundingClientRect();
    const margin = 8;
    const left = Math.min(Math.max(margin, t.left), window.innerWidth - b.width - margin);
    const above = t.top - b.height - 6;
    setPos({ left, top: above >= margin ? above : t.bottom + 6 });
  }, [open, text]);

  return (
    <span
      ref={trigger}
      className="cursor-default"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      {children}
      {open &&
        createPortal(
          <span
            ref={bubble}
            role="tooltip"
            style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? "visible" : "hidden" }}
            className="pointer-events-none fixed z-[100] w-max max-w-[260px] rounded-md border border-line-strong bg-panel px-2.5 py-1.5 font-sans text-[11.5px] leading-snug text-ink shadow-lg"
          >
            {text}
          </span>,
          document.body,
        )}
    </span>
  );
}
