"use client";

import type { Card, Column } from "@/lib/types";
import type { ResumeHow } from "@/lib/card-resume";
import { busyHere } from "@/lib/overlap";
import CardView from "./CardView";
import ColumnHeader from "./ColumnHeader";
import CrashGuard from "./CrashGuard";
import Icon from "./Icon";

const COLUMN_LIMIT = 40;

const EMPTY_HINT: Record<Column, string> = {
  backlog: "New threads wait here until you start them",
  running: "Drag a backlog card here to start it",
  needs_you: "Cards land here when an agent asks for permission",
  review: "Cards land here when a turn finishes",
  done: "Drag reviewed threads here",
};

export type ColumnSectionProps = {
  column: { id: Column; label: string };
  list: Card[];
  cards: Card[];
  selectedId: string | null;
  unseen: ReadonlySet<string>;
  now: number;
  loaded: boolean;
  filtering: boolean;
  showArchived: boolean;
  archivedCount: number;
  dragOver: Column | null;
  expandedColumns: Column[];
  view: string;
  switchAll: (column: Column) => void | Promise<void>;
  setShowArchived: React.Dispatch<React.SetStateAction<boolean>>;
  setExpanded: React.Dispatch<React.SetStateAction<{ view: string; columns: Column[] }>>;
  setDragOver: React.Dispatch<React.SetStateAction<Column | null>>;
  drop: (column: Column, e: React.DragEvent) => void;
  onColumnMenu: (column: Column, e: React.MouseEvent) => void | Promise<void>;
  onCardMenu: (card: Card, e: React.MouseEvent) => void | Promise<void>;
  onStarMenu: (card: Card, e: React.MouseEvent) => void | Promise<void>;
  openCard: (card: Card) => void;
  openNew: () => void;
  resume: (id: string, how: ResumeHow) => void | Promise<void>;
  onAnswer: (card: Card, allow: boolean) => void;
  onStop: (card: Card) => void;
  notify: (msg: string) => void;
};

export default function ColumnSection({
  column,
  list,
  cards,
  selectedId,
  unseen,
  now,
  loaded,
  filtering,
  showArchived,
  archivedCount,
  dragOver,
  expandedColumns,
  view,
  switchAll,
  setShowArchived,
  setExpanded,
  setDragOver,
  drop,
  onColumnMenu,
  onCardMenu,
  onStarMenu,
  openCard,
  openNew,
  resume,
  onAnswer,
  onStop,
}: ColumnSectionProps) {
  const shown = expandedColumns.includes(column.id) ? list : list.slice(0, COLUMN_LIMIT);
  const isDragOver = dragOver === column.id;

  return (
    <section
      data-column={column.id}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(column.id);
      }}
      onDragLeave={() => setDragOver((c) => (c === column.id ? null : c))}
      onDrop={(e) => drop(column.id, e)}
      onContextMenu={(e) => void onColumnMenu(column.id, e)}
      className={`flex w-[264px] min-w-[220px] shrink-0 flex-col rounded-xl border ${isDragOver ? "border-accent bg-accent-soft" : "border-transparent bg-sunken"}`}
    >
      <ColumnHeader
        column={column}
        count={list.length}
        needsYou={column.id === "needs_you" && list.length > 0}
        onSwitchAll={column.id === "running" || column.id === "needs_you" ? () => switchAll(column.id) : undefined}
      />
      {column.id === "done" && archivedCount > 0 && (
        <div className="-mt-1 flex justify-end px-3 pb-1 text-[11.5px] text-faint">
          <button onClick={() => setShowArchived((v) => !v)} className="hover:text-ink" aria-pressed={showArchived}>
            {showArchived ? "Hide" : "Show"} {archivedCount} archived
          </button>
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
        {shown.map((card) => (
          <CrashGuard key={card.id} what="card" name={card.title}>
            <CardView
              card={card}
              now={now}
              selected={card.id === selectedId}
              unseen={unseen.has(card.id)}
              alsoHere={busyHere(cards, card)}
              onOpen={() => openCard(card)}
              onAnswer={(allow) => onAnswer(card, allow)}
              onStop={() => onStop(card)}
              onResume={(how) => void resume(card.id, how)}
              onContextMenu={(e) => void onCardMenu(card, e)}
              onStarMenu={(e) => void onStarMenu(card, e)}
            />
          </CrashGuard>
        ))}
        {shown.length < list.length && (
          <button
            onClick={() => setExpanded({ view, columns: [...expandedColumns, column.id] })}
            className="rounded-lg px-2 py-1.5 text-center text-[12px] text-muted hover:bg-card hover:text-ink"
          >
            Show {list.length - shown.length} more
          </button>
        )}
        {loaded && list.length === 0 && (
          <p className="px-2 py-3 text-center text-[11.5px] leading-snug text-faint">
            {filtering ? "No matching cards" : EMPTY_HINT[column.id]}
          </p>
        )}
        {column.id === "backlog" && (
          <button
            onClick={() => openNew()}
            className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12.5px] text-muted hover:bg-card hover:text-ink"
          >
            <Icon name="plus" size={13} /> Add a thread
          </button>
        )}
      </div>
    </section>
  );
}
