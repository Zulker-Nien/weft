"use client";

import { createContext, useContext, type ReactNode } from "react";
import { tagColor } from "@/lib/rail-view";

// Each tag's colour from the catalog (app/api/tags), by name; the board provides it. A tag it doesn't
// know gets the steady hue from its name (lib/tags.ts tagHue).
export const TagColors = createContext<Record<string, string>>({});

export function useTagColor(tag: string) {
  return useContext(TagColors)[tag] ?? tagColor(tag);
}

// A small tag pill, tinted with the tag's colour. Children go after the name (the editor's ✕).
export default function TagPill({ tag, title, children, className = "min-w-0 max-w-[90px] shrink" }: { tag: string; title?: string; children?: ReactNode; className?: string }) {
  const color = useTagColor(tag);
  return (
    <span
      title={title ?? `#${tag}`}
      style={{ backgroundColor: `color-mix(in srgb, ${color} 16%, transparent)`, color: `color-mix(in srgb, ${color} 70%, var(--ink))` }}
      className={`inline-flex items-center gap-0.5 rounded-full px-1.5 text-[10.5px] font-medium leading-[16px] ${className}`}
    >
      <span className="truncate">{tag}</span>
      {children}
    </span>
  );
}

// The colour dot beside a tag in the drawer.
export function TagDot({ tag, className = "" }: { tag: string; className?: string }) {
  return <span aria-hidden className={`size-2.5 shrink-0 rounded-full ${className}`} style={{ backgroundColor: useTagColor(tag) }} />;
}
