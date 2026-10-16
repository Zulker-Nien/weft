"use client";

// The weft.zip board at /[orgSlug]/board: the desktop board's own columns, cards and thread
// components, drawn read-only from the opted-in cards the Macs sync (docs/architecture/cloud-sync.md).
// Server hands it the org id, the initial rows and, with ?card=…, that card's first page of thread;
// useWebBoard keeps both live over Supabase Realtime.
import { useMemo, useState } from "react";
import { groupByColumn, summarizeProjects, type SortKey } from "@/lib/board-view";
import type { CloudCommandRow } from "@/lib/cloud-commands";
import type { CloudCardRow, CloudThreadItemRow } from "@/lib/cloud-sync-types";
import { useNow } from "@/lib/use-now";
import { ToolResultSourceContext } from "@/lib/use-tool-result";
import { busyHere } from "@/lib/overlap";
import { COLUMNS, type Column } from "@/lib/types";
import { boardCounts, webCards } from "@/lib/web-board";
import { webTargets } from "@/lib/web-commands";
import CardView from "../CardView";
import ColumnHeader from "../ColumnHeader";
import ColumnPlaceholder from "../ColumnPlaceholder";
import { useWebBoard, type LiveStatus } from "./useWebBoard";
import { WebCommandStrip } from "./WebCommandStrip";
import { WebNewCardDialog } from "./WebNewCardDialog";
import { WebProjectBar } from "./WebProjectBar";
import { WebThreadPanel } from "./WebThreadPanel";

export interface WebBoardProps {
  orgId: string;
  orgSlug: string;
  userId: string;
  initialCommands: CloudCommandRow[];
  initialCards: CloudCardRow[];
  openCardId: string | null;
  initialThread: CloudThreadItemRow[];
  initialBlobUrls: Record<string, string>;
}

// How many cards a column draws before "Show N more", the desktop's own number.
const COLUMN_LIMIT = 40;

// A card's folder is its project; there is no worktree folding here, so a path stands for itself.
const identity = (cwd: string) => cwd;

function LiveDot({ status }: { status: LiveStatus }) {
  const label = status === "live" ? "Live" : status === "connecting" ? "Connecting…" : "Offline";
  return (
    <span className="flex items-center gap-1.5 text-[12px] text-muted" aria-live="polite">
      <span aria-hidden="true" className={`size-2 rounded-full ${status === "live" ? "bg-ok" : "bg-faint"}`} />
      {label}
    </span>
  );
}

export function WebBoard({ orgId, orgSlug, userId, initialCommands, initialCards, openCardId, initialThread, initialBlobUrls }: WebBoardProps) {
  const board = useWebBoard({ orgId, userId, initialCommands, initialCards, openCardId, initialThread, initialBlobUrls });
  const now = useNow();
  const [project, setProject] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("newest");
  const [showArchived, setShowArchived] = useState(false);
  const [expanded, setExpanded] = useState<Column[]>([]);
  const [composing, setComposing] = useState(false);

  const cards = useMemo(() => webCards(board.cards), [board.cards]);
  const byColumn = useMemo(() => groupByColumn(cards, { project, query, sort, showArchived }, identity), [cards, project, query, sort, showArchived]);
  const projects = useMemo(() => summarizeProjects([], cards, identity), [cards]);
  const { running, waiting } = boardCounts(cards);
  const targets = useMemo(() => webTargets(board.cards, userId), [board.cards, userId]);
  const archivedCount = cards.filter((c) => c.archived).length;
  const filtering = project !== null || query.trim() !== "";

  const active = board.activeCardId ? board.cards.find((r) => r.card_id === board.activeCardId) : undefined;

  return (
    <ToolResultSourceContext.Provider value={board.toolOutput}>
      <div className="wz-desk" data-theme="dark">
        <header className="flex shrink-0 items-center gap-3 border-b border-line bg-panel px-4 py-2.5">
          <h1 className="text-[15px] font-semibold tracking-tight text-ink">Board</h1>
          <span className="text-[12px] text-muted">
            {orgSlug} · {running} running
            {waiting > 0 && <span className="text-warn"> · {waiting} need{waiting === 1 ? "s" : ""} you</span>}
          </span>
          <div className="flex-1" />
          <LiveDot status={board.live} />
          <button onClick={() => setComposing(true)} className="rounded-md bg-accent px-2.5 py-1 text-[12px] font-medium text-on-accent hover:opacity-90">
            New thread
          </button>
        </header>
        <WebCommandStrip commands={board.commands} onDrop={(id) => void board.dropCommand(id)} />

        {cards.length === 0 ? (
          <p className="m-6 rounded-lg border border-line bg-sunken p-6 text-[13.5px] leading-relaxed text-muted">
            No synced cards yet. Cards show here once a project&apos;s switch is on in the desktop app&apos;s <strong className="text-ink">Settings → Sync</strong>.
          </p>
        ) : (
          <>
            <WebProjectBar projects={projects} total={cards.length} selected={project} onSelect={setProject} query={query} onQuery={setQuery} sort={sort} onSort={setSort} />
            <main className="flex min-h-0 min-w-0 flex-1 gap-3 overflow-x-auto p-3">
              {COLUMNS.map((column) => {
                const list = byColumn.get(column.id) ?? [];
                const shown = expanded.includes(column.id) ? list : list.slice(0, COLUMN_LIMIT);
                return (
                  <section key={column.id} data-column={column.id} style={{ minWidth: 170 }} className="@container flex w-[264px] shrink flex-col rounded-xl border border-transparent bg-sunken">
                    <ColumnHeader
                      column={column}
                      count={list.length}
                      needsYou={column.id === "needs_you" && list.length > 0}
                      archivedCount={archivedCount}
                      showArchived={showArchived}
                      onToggleArchived={() => setShowArchived((v) => !v)}
                      toArchive={0}
                      archiveTip=""
                      onArchiveAll={() => {}}
                    />
                    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
                      {shown.map((card) => (
                        <CardView key={card.id} readOnly card={card} now={now} selected={card.id === board.activeCardId} alsoHere={busyHere(cards, card)} onOpen={() => void board.openCard(card.id)} />
                      ))}
                      {shown.length < list.length && (
                        <button onClick={() => setExpanded((cols) => [...cols, column.id])} className="rounded-lg px-2 py-1.5 text-center text-[12px] text-muted hover:bg-card hover:text-ink">
                          Show {list.length - shown.length} more
                        </button>
                      )}
                      <ColumnPlaceholder column={column.id} loaded empty={list.length === 0} filtering={filtering} />
                    </div>
                  </section>
                );
              })}
            </main>
          </>
        )}

        {composing && <WebNewCardDialog targets={targets} defaultFolder={project} onSend={board.startCard} onClose={() => setComposing(false)} />}

        {active && board.thread && (
          <WebThreadPanel card={active.card} ownerDevice={active.owner_device} window={board.thread} blobUrls={board.blobUrls} onClose={board.closeCard} onLoadOlder={() => void board.loadOlder()} />
        )}
      </div>
    </ToolResultSourceContext.Provider>
  );
}
