"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import { isLive } from "@/lib/format";
import { BACKENDS, CODEX_DEFAULT_MODEL, MODELS, runningOn } from "@/lib/new-thread";
import { BACKEND_LABELS, type Backend, type Card } from "@/lib/types";
import { useEscape } from "@/lib/use-escape";
import { BackendBadge } from "./CardView";
import Icon from "./Icon";

// A clickable version of the CLI chip for the thread header. Click it and pick a model: one of this
// CLI's swaps the open CLI's model, one of the other CLI's switches CLI and the next turn runs there
// (stop the thread first). No replay by default — that's the rate-limit banner's job (and it
// always replays). The copilot is locked to claude, so it gets the static badge instead.
export default function BackendPicker({ card }: { card: Card }) {
  // Without a "[1m]" context suffix, so it matches a MODELS id.
  const model = runningOn(card).model?.replace(/\[[^\]]*\]$/, "");
  const selectedModel = card.backend === "codex" && (!model || model === "Codex") ? CODEX_DEFAULT_MODEL : model;
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

  function pick(next: Backend, id: string) {
    setOpen(false);
    if (next === card.backend && id === selectedModel) return;
    void api.switchBackend(card.id, next, false, id).catch(() => {});
  }

  if (locked) return <BackendBadge backend={card.backend} card={card} />;

  const row = "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-accent-soft disabled:opacity-40 disabled:hover:bg-transparent";
  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Switch model (currently ${BACKEND_LABELS[card.backend]})`}
        aria-expanded={open}
        title="Switch model or CLI"
        className={`shrink-0 rounded ${model ? "" : "px-0"}`}
      >
        <BackendBadge backend={card.backend} card={card} />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-48 rounded-lg border border-line bg-panel p-1 shadow-lg">
          {BACKENDS.map((b) => (
            <div key={b.id} role="group" aria-label={b.label}>
              <p className="px-2 pb-0.5 pt-1.5 text-[11px] font-medium text-faint">{b.label}</p>
              {MODELS[b.id].map((m) => {
                const on = card.backend === b.id && selectedModel === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    disabled={live && b.id !== card.backend}
                    onClick={() => pick(b.id, m.id)}
                    className={row}
                    aria-pressed={on}
                  >
                    <span className="flex w-[14px] shrink-0 justify-center text-accent">
                      {on && <Icon name="check" size={13} />}
                    </span>
                    <span className="flex-1 font-medium text-ink">{m.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
          {live && <p className="px-2 pb-1 pt-1.5 text-[11px] leading-snug text-faint">Stop the thread to switch CLI.</p>}
        </div>
      )}
    </div>
  );
}
