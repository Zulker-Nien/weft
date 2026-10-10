"use client";

import { keyCaps } from "@/lib/hotkeys";

// One raised key cap, e.g. "⌘" or "K".
export function Cap({ children, small = false }: { children: string; small?: boolean }) {
  return (
    <kbd
      className={`inline-block rounded border border-b-2 border-line-strong bg-canvas text-center font-mono leading-none text-ink ${
        small ? "min-w-[16px] px-1 py-0.5 text-[10.5px]" : "min-w-[22px] px-1.5 py-1 text-[11.5px]"
      }`}
    >
      {children}
    </kbd>
  );
}

// One key spec ("mod+k", "shift+a", "?") drawn as key caps.
export default function KeyCaps({ spec, small = false }: { spec: string; small?: boolean }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {keyCaps(spec).map((cap, i) => (
        <Cap key={i} small={small}>
          {cap}
        </Cap>
      ))}
    </span>
  );
}
