"use client";

import { canContinue, canRestart, type ResumeHow } from "@/lib/card-resume";
import type { Card } from "@/lib/types";
import Icon from "./Icon";

export type { ResumeHow };

// The ▶ in a card's footer: sends "continue" into its session, for a thread that gave up too early.
export function ContinueButton({ card, onResume }: { card: Card; onResume?: (how: ResumeHow) => void }) {
  if (!onResume || !canContinue(card)) return null;
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onResume("continue");
      }}
      title="Continue: send “continue” so the thread keeps going"
      aria-label="Continue"
      className="rounded p-1 text-muted hover:bg-sunken hover:text-accent"
    >
      <Icon name="play" size={12} />
    </button>
  );
}

// Restart on a card whose turn was stopped or failed: its last message again, in a fresh CLI.
export function RestartButton({ card, onResume }: { card: Card; onResume?: (how: ResumeHow) => void }) {
  if (!onResume || !canRestart(card)) return null;
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onResume("restart");
      }}
      aria-label="Restart"
      title="Run your last message again in a fresh CLI"
      className="mt-2 flex items-center gap-1 rounded-md border border-line-strong px-2.5 py-1 text-[12px] text-ink hover:bg-sunken"
    >
      <Icon name="reload" size={11} />
      Restart
    </button>
  );
}
