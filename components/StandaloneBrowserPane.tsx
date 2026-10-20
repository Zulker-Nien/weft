"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useSlideOut } from "@/lib/use-slide-out";

// The standalone browser pane's slide-in/slide-out wrapper: its width transitions between 0
// (closed) and `width` (open) over `SLIDE_MS`, and the inner content (the BrowserPane +
// show rail) stays mounted during the close via useSlideOut so the transition has something
// to animate. The inner content is clipped with overflow-hidden, so a partially open pane
// reveals from its left edge.
export const SLIDE_MS = 200;

export default function StandaloneBrowserPane({
  open,
  width,
  children,
}: {
  open: boolean;
  width: number;
  // Gets `sliding`, true while the pane slides in. The page is a native view laid over the pane, which CSS can't
  // clip, so BrowserPane keeps it hidden until the pane is all the way open (its `obscured`).
  children: (sliding: boolean) => ReactNode;
}) {
  // Keep the children mounted briefly after close so the slide-out can play.
  // useSlideOut expects a string|null, so we key on "board" when open, null when closed.
  const shown = useSlideOut(open ? "board" : null, SLIDE_MS);
  const sliding = useSlidingIn(open);
  return (
    // A flex row, so the pane stretches to the board's full height: as a block child it shrank to its toolbar, the
    // page's placeholder measured 0 px tall, and the shell hid the page (electron/browser-pane.cjs `layout`).
    <div
      className={`flex shrink-0 overflow-hidden ${shown.closing ? "pointer-events-none" : ""}`}
      style={{
        width: open ? width : 0,
        transition: `width ${SLIDE_MS}ms ease-out`,
      }}
      aria-hidden={!open}
    >
      {shown.shown && children(sliding)}
    </div>
  );
}

// True for SLIDE_MS after `open` turns on. Set while rendering, not in an effect, so the pane's first bounds
// report already sees it and the page never flashes over the columns before the slide.
function useSlidingIn(open: boolean): boolean {
  const [was, setWas] = useState(open);
  const [sliding, setSliding] = useState(false);
  if (open !== was) {
    setWas(open);
    setSliding(open);
  }
  useEffect(() => {
    if (!sliding) return;
    const timer = setTimeout(() => setSliding(false), SLIDE_MS);
    return () => clearTimeout(timer);
  }, [sliding]);
  return sliding;
}
