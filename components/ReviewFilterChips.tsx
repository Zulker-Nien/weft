"use client";

import type { ReviewFilter, ReviewFilterKey } from "@/lib/board-view";
import Icon from "./Icon";
import Tip from "./Tip";

// What the Review header needs for its chips: which are on, how many shown cards each matches, and the toggle.
export interface ReviewChips {
  on: ReviewFilter;
  counts: Record<ReviewFilterKey, number>;
  toggle: (key: ReviewFilterKey) => void;
}

const CHIPS: { key: ReviewFilterKey; icon: "alert" | "clock"; label: string; tip: string }[] = [
  { key: "errors", icon: "alert", label: "Errors", tip: "Show only Review cards whose turn ended in an error" },
  { key: "restart", icon: "clock", label: "Restart errors", tip: "Show only Review cards that hit the 5-hour session limit" },
];

// Review's two strict quick filters. Each toggles on its own; an active one is tinted and carries its count.
// The header is narrow, so an inactive chip is its icon (its tip names it) and an active one adds its label.
export default function ReviewFilterChips({ chips }: { chips: ReviewChips }) {
  return (
    <>
      {CHIPS.map(({ key, icon, label, tip }) => {
        const active = chips.on[key];
        return (
          <Tip key={key} text={tip} className="inline-flex">
            <button
              onClick={() => chips.toggle(key)}
              aria-pressed={active}
              aria-label={label}
              className={`flex items-center gap-1 rounded-full px-1.5 py-px ${active ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-hover hover:text-ink"}`}
            >
              <Icon name={icon} size={11} />
              <span className={active ? "@max-[230px]:hidden" : "hidden @min-[400px]:inline"}>{label}</span>
              {active && <span>· {chips.counts[key]}</span>}
            </button>
          </Tip>
        );
      })}
    </>
  );
}
