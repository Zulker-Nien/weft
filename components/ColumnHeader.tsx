"use client";

import type { Column } from "@/lib/types";
import { SwitchAllButton } from "./switch-all-button";

// A column's name and count. Running and Needs you get "Switch all" (from SwitchAllButton) so the
// user can move that column's in-flight threads to the other CLI without per-card clicks.
export default function ColumnHeader({
  column,
  count,
  needsYou,
  onSwitchAll,
}: {
  column: { id: Column; label: string };
  count: number;
  needsYou: boolean;
  // Shown only when "switch all" makes sense for this column (handled by the caller).
  onSwitchAll?: () => void | Promise<void>;
}) {
  return (
    <div className="flex items-center justify-between px-3 pb-1.5 pt-2.5">
      <h2 className={`text-[12.5px] font-medium ${needsYou ? "text-warn" : "text-ink"}`}>{column.label}</h2>
      <span className="flex items-center gap-2 text-[11.5px] text-faint">
        {onSwitchAll && count > 0 ? <SwitchAllButton onClick={() => { void onSwitchAll(); }} /> : null}
        {count}
      </span>
    </div>
  );
}