"use client";

// One column on the board: the header (with column-specific actions), a scrollable list of cards,
// a "Show more" button when the column is collapsed, and the placeholder / add-thread button.
// CardView is loaded through guarded() in Board.tsx and rendered via the `renderCard` prop so this
// file does not have to know the lazy-load wrapper.
import type { CSSProperties, DragEvent, MouseEvent, ReactNode } from "react";
import type { Card, Column } from "@/lib/types";
import type { LaneState } from "@/lib/copilot-lane";
import { columnMinWidth } from "@/lib/copilot-lane";
import { busyHere } from "@/lib/overlap";
import Icon from "./Icon";
import ColumnHeader from "./ColumnHeader";
import ColumnPlaceholder from "./ColumnPlaceholder";

// Cards shown per column until "Show more"; picking up Claude Code sessions can put hundreds in one.
export const COLUMN_LIMIT = 40;

export interface BoardColumnProps {
  column: { id: Column; label: string };
  shown: readonly Card[];
  count: number;
  loaded: boolean;
  filtering: boolean;
  // Per-column visual state.
  dragOver: boolean;
  laneState: LaneState;
  // "Show N more" button: called with the column id so Board can track which columns are expanded.
  onShowMore: () => void;
  // Renders one card row (Board.tsx owns the lazy-loaded CardView component).
  renderCard: (card: Card) => ReactNode;
  // Column actions.
  onDragOver: (e: DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: DragEvent) => void;
  onColumnContextMenu: (e: MouseEvent) => void;
  // Column header props.
  needsYou: boolean;
  archivedCount: number;
  showArchived: boolean;
  onToggleArchived: () => void;
  toArchive: number;
  archiveTip: string;
  onArchiveAll: () => void;
  resumeAll?: { count: number; run: () => void };
  onSwitchAll?: () => void | Promise<void>;
  onReviewAll?: () => Promise<void>;
  onAddBacklog: () => void;
}

export default function BoardColumn({
  column,
  shown,
  count,
  loaded,
  filtering,
  dragOver,
  laneState,
  onShowMore,
  renderCard,
  onDragOver,
  onDragLeave,
  onDrop,
  onColumnContextMenu,
  needsYou,
  archivedCount,
  showArchived,
  onToggleArchived,
  toArchive,
  archiveTip,
  onArchiveAll,
  resumeAll,
  onSwitchAll,
  onReviewAll,
  onAddBacklog,
}: BoardColumnProps) {
  const style: CSSProperties = { minWidth: columnMinWidth(laneState) };
  return (
    <section
      data-column={column.id}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onContextMenu={onColumnContextMenu}
      style={style}
      className={`@container flex w-[264px] shrink flex-col rounded-xl border ${dragOver ? "border-accent bg-accent-soft" : "border-transparent bg-sunken"}`}
    >
      <ColumnHeader
        column={column}
        count={loaded ? count : null}
        needsYou={needsYou}
        archivedCount={archivedCount}
        showArchived={showArchived}
        onToggleArchived={onToggleArchived}
        toArchive={toArchive}
        archiveTip={archiveTip}
        onArchiveAll={onArchiveAll}
        resumeAll={resumeAll}
        onSwitchAll={onSwitchAll}
        onReviewAll={onReviewAll}
      />
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
        {shown.map((card) => renderCard(card))}
        {shown.length < count && (
          <button
            onClick={onShowMore}
            className="rounded-lg px-2 py-1.5 text-center text-[12px] text-muted hover:bg-card hover:text-ink"
          >
            Show {count - shown.length} more
          </button>
        )}
        <ColumnPlaceholder column={column.id} loaded={loaded} empty={count === 0} filtering={filtering} />
        {column.id === "backlog" && (
          <button
            onClick={onAddBacklog}
            className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12.5px] text-muted hover:bg-card hover:text-ink"
          >
            <Icon name="plus" size={13} /> Add a thread
          </button>
        )}
      </div>
    </section>
  );
}

// Re-export the helper for callers that still want to compute "is this card overlapping?"
export { busyHere };
