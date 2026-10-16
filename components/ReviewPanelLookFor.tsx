"use client";

import { useState } from "react";

// What to look for, held to two lines so a wordy step can't push the feedback box off a small screen; click to read it all.
export function ReviewPanelLookFor({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <p
      onClick={() => setOpen((o) => !o)}
      className={`mt-1.5 cursor-default text-[12.5px] leading-relaxed text-muted ${open ? "" : "line-clamp-2"}`}
    >
      <span className="font-medium text-ink">Look for: </span>
      {text}
    </p>
  );
}