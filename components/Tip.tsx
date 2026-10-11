"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { currentArea, fitWidth, placeAbove } from "@/lib/float-place";

// A hover bubble above its child, kept inside the window and out from under the browser pane. Native title tooltips don't show in the
// desktop app, so this draws its own, in a portal so no panel or dialog can clip it.
export default function Tip({
  text,
  children,
  className = "",
  off = false,
}: {
  text: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  off?: boolean;
}) {
  const trigger = useRef<HTMLSpanElement>(null);
  const bubble = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !trigger.current || !bubble.current) {
      setPos(null);
      return;
    }
    // Inside the window and clear of the browser pane, which no z-index can rise above.
    setPos(placeAbove(trigger.current.getBoundingClientRect(), bubble.current.getBoundingClientRect(), currentArea()));
  }, [open, text]);

  return (
    <span
      ref={trigger}
      className={`cursor-default ${className}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      {children}
      {open &&
        !off &&
        createPortal(
          <span
            ref={bubble}
            role="tooltip"
            style={{
              left: pos?.left ?? 0,
              top: pos?.top ?? 0,
              maxWidth: fitWidth(currentArea(), 260),
              visibility: pos ? "visible" : "hidden",
            }}
            className="pointer-events-none fixed z-[100] w-max rounded-md border border-line-strong bg-panel px-2.5 py-1.5 font-sans text-[11.5px] leading-snug text-ink shadow-lg"
          >
            {text}
          </span>,
          document.body,
        )}
    </span>
  );
}
