"use client";

import { tipById, type TipId } from "@/lib/tips";
import { useAnchorRect } from "@/lib/use-anchor-rect";
import CrashGuard from "./CrashGuard";

// A one-time coach tip (lib/tips.ts): a small bubble under its column's header, pointing up at it, with an
// optional action and Got it. It sits under the open card's backdrop (z-30), so it never covers a thread.
function Bubble({ id, onAction, onDismiss }: { id: TipId; onAction: (id: TipId) => void; onDismiss: (id: TipId) => void }) {
  const tip = tipById(id);
  const rect = useAnchorRect(`.board-sheet [data-column="${tip.column}"]`);
  if (!rect) return null;
  const width = Math.min(240, Math.max(180, rect.width - 12));
  return (
    <div
      role="status"
      data-tip={id}
      style={{ top: rect.headerBottom + 8, left: rect.left + 6, width }}
      className="fixed z-20 rounded-lg border border-accent bg-panel p-2.5 text-[12px] text-ink shadow-lg"
    >
      <span aria-hidden="true" className="absolute -top-[6px] left-5 h-2.5 w-2.5 rotate-45 border-l border-t border-accent bg-panel" />
      <p className="leading-snug">{tip.text}</p>
      <span className="mt-2 flex justify-end gap-1.5">
        {tip.action && (
          <button type="button" onClick={() => onAction(id)} className="rounded-md bg-accent px-2 py-0.5 text-[11.5px] font-semibold text-on-accent">
            {tip.action.label}
          </button>
        )}
        <button type="button" onClick={() => onDismiss(id)} className="rounded-md border border-line px-2 py-0.5 text-[11.5px] text-ink hover:bg-sunken">
          Got it
        </button>
      </span>
    </div>
  );
}

export default function CoachTip(props: { id: TipId; onAction: (id: TipId) => void; onDismiss: (id: TipId) => void }) {
  return (
    <CrashGuard what="tip" inline>
      <Bubble {...props} />
    </CrashGuard>
  );
}
