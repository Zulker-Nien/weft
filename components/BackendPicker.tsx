"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import { isLive } from "@/lib/format";
import { runningOn } from "@/lib/new-thread";
import { BACKEND_LABELS, type Backend, type Card } from "@/lib/types";
import { useEscape } from "@/lib/use-escape";
import { BackendBadge } from "./CardView";
import Icon from "./Icon";

// A clickable version of the CLI chip for the thread header. Click it, pick the other CLI, and
// the next turn runs there. No replay by default — that's the rate-limit banner's job (and it
// always replays). The copilot is locked to claude, so it gets the static badge instead.
export default function BackendPicker({ card }: { card: Card }) {
  const { model } = runningOn(card);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const live = isLive(card);
  const locked = card.role === "copilot";
  useEscape(open, () => setOpen(false));

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", away);
    return () => window.removeEventListener("pointerdown", away);
  }, [open]);

  function pick(next: Backend) {
    setOpen(false);
    if (next === card.backend) return;
    void api.switchBackend(card.id, next, false).catch(() => {});
  }

  if (locked) return <BackendBadge backend={card.backend} card={card} />;

  const row = "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-accent-soft disabled:opacity-40 disabled:hover:bg-transparent";
  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Switch CLI (currently ${BACKEND_LABELS[card.backend]})`}
        aria-expanded={open}
        title={live ? "Stop the thread to switch CLI" : "Switch CLI"}
        className={`shrink-0 rounded ${model ? "" : "px-0"}`}
      >
        <BackendBadge backend={card.backend} card={card} />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-48 rounded-lg border border-line bg-panel p-1 shadow-lg">
          {(["claude", "puku"] as const).map((b) => (
            <button
              key={b}
              type="button"
              disabled={live}
              onClick={() => pick(b)}
              className={row}
              aria-pressed={card.backend === b}
            >
              <span className="flex w-[14px] shrink-0 justify-center text-accent">
                {card.backend === b && <Icon name="check" size={13} />}
              </span>
              <span className="flex-1 font-medium text-ink">{BACKEND_LABELS[b]}</span>
            </button>
          ))}
          <p className="px-2 pb-1 pt-1.5 text-[11px] leading-snug text-faint">
            {live
              ? "Stop the thread to switch."
              : `Next turn runs on ${card.backend === "puku" ? "Claude Code" : "puku-cli"}.`}
          </p>
        </div>
      )}
    </div>
  );
}
