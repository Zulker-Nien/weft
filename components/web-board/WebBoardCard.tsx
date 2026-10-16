"use client";

// A single card on the web board. Plain anchor so right-click / middle-click / cmd-click open
// the side panel in a new tab the same way the user expects from any link.
import type { WebBoardCard as WebBoardCardShape } from "@/lib/web-board";

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Date.now() - then;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}

export function WebBoardCard({ entry, active, onOpen }: { entry: WebBoardCardShape; active: boolean; onOpen: (id: string) => void }) {
  const stage = entry.card.lastLine || entry.card.stage;
  return (
    <button
      type="button"
      className={`wz-boardCard${active ? " wz-boardCard-active" : ""}`}
      onClick={() => onOpen(entry.id)}
      aria-pressed={active}
    >
      <div className="wz-boardCardTitle">{entry.card.title}</div>
      {stage ? <div className="wz-boardCardStage">{stage}</div> : null}
      <div className="wz-boardCardMeta">
        {entry.folder ? <span>{entry.folder}</span> : null}
        {entry.folder ? <span className="wz-boardCardMetaSep">·</span> : null}
        <span>{relativeTime(entry.updatedAt)}</span>
      </div>
    </button>
  );
}