"use client";

import { keyCaps } from "@/lib/hotkeys";

// One raised key cap, e.g. "⌘" or "K".
export function Cap({ children, small = false, large = false }: { children: string; small?: boolean; large?: boolean }) {
  return (
    <kbd
      className={`inline-block rounded border border-b-2 border-line-strong bg-canvas text-center font-mono leading-none text-ink ${
        small
          ? "min-w-[16px] px-1 py-0.5 text-[10.5px]"
          : large
            ? "min-w-[26px] px-2 py-1.5 text-[13px]"
            : "min-w-[22px] px-1.5 py-1 text-[11.5px]"
      }`}
    >
      {children}
    </kbd>
  );
}

// One key spec ("mod+k", "shift+a", "?") drawn as key caps.
export default function KeyCaps({ spec, small = false, large = false }: { spec: string; small?: boolean; large?: boolean }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {keyCaps(spec).map((cap, i) => (
        <Cap key={i} small={small} large={large}>
          {cap}
        </Cap>
      ))}
    </span>
  );
}
