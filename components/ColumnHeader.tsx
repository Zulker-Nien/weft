"use client";

import type { Column } from "@/lib/types";
import Icon from "./Icon";
import { SwitchAllButton } from "./switch-all-button";
import Tip from "./Tip";

// A column's name and count. Running and Needs you get "Switch all" to move their threads to the other CLI. Review gets "▶ Resume N" when turns there were cut off or failed (lib/card-resume.ts). Done also gets "Show N archived" and an archive-all button (Shift+E) for the cards it shows.
export default function ColumnHeader({
  column,
  count,
  needsYou,
  archivedCount,
  showArchived,
  onToggleArchived,
  toArchive,
  archiveTip,
  onArchiveAll,
  resumeAll,
  onSwitchAll,
}: {
  column: { id: Column; label: string };
  count: number | null;
  needsYou: boolean;
  archivedCount: number;
  showArchived: boolean;
  onToggleArchived: () => void;
  toArchive: number;
  archiveTip: string;
  onArchiveAll: () => void;
  resumeAll?: { count: number; run: () => void };
  onSwitchAll?: () => void | Promise<void>;
}) {
  const done = column.id === "done";
  return (
    <div className="flex items-center justify-between px-3 pb-1.5 pt-2.5">
      <h2 className={`text-[12.5px] font-medium ${needsYou ? "text-warn" : "text-ink"}`}>{column.label}</h2>
      <span className="flex items-center gap-2 text-[11.5px] text-faint">
        {onSwitchAll && count ? <SwitchAllButton onClick={() => void onSwitchAll()} /> : null}
        {resumeAll && (
          <Tip text={`Carry on the ${resumeAll.count} turn${resumeAll.count > 1 ? "s" : ""} here that a restart cut off or that failed`} className="inline-flex">
            <button onClick={resumeAll.run} className="flex items-center gap-1 font-medium text-accent hover:opacity-80">
              <Icon name="play" size={10} />
              Resume {resumeAll.count}
            </button>
          </Tip>
        )}
        {done && archivedCount > 0 && (
          <button onClick={onToggleArchived} className="hover:text-ink" aria-pressed={showArchived}>
            {showArchived ? "Hide" : "Show"} {archivedCount} archived
          </button>
        )}
        {done && toArchive > 0 && (
          <Tip text={archiveTip} className="inline-flex">
            <button onClick={onArchiveAll} className="rounded p-0.5 hover:bg-hover hover:text-ink" aria-label={`Archive all ${toArchive} in Done`}>
              <Icon name="archive" size={13} />
            </button>
          </Tip>
        )}
        {count}
      </span>
    </div>
  );
}
