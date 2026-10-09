"use client";

import { folderName, isLive } from "@/lib/format";
import type { Card, ThreadItem } from "@/lib/types";
import { BackendBadge } from "./CardView";
import Icon from "./Icon";
import ThreadView from "./ThreadView";

export default function ThreadPanel({
  card,
  items,
  streaming,
  onSend,
  onAnswer,
  onStop,
  onDelete,
  onClose,
}: {
  card: Card;
  items: ThreadItem[];
  streaming: string;
  onSend: (text: string) => Promise<void>;
  onAnswer: (allow: boolean, answers?: Record<string, string>) => void;
  onStop: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const live = isLive(card);

  return (
    <aside className="flex w-[460px] shrink-0 flex-col border-l border-line bg-panel">
      <header className="flex items-start gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="line-clamp-2 text-[14px] font-medium leading-snug text-ink">{card.title}</h2>
          <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-muted">
            <BackendBadge backend={card.backend} />
            <span className="truncate" title={card.cwd}>{folderName(card.cwd)}</span>
            {card.sessionId && (
              <span className="font-mono text-faint" title={card.sessionId}>· {card.sessionId.slice(0, 8)}</span>
            )}
            {card.warm && (
              <span className="text-ok" title="The CLI is open, so a reply starts right away">· live</span>
            )}
          </div>
          {(card.stage || card.remaining) && (
            <div className="mt-1.5 flex min-w-0 items-center gap-1.5 text-[11.5px]">
              {card.stage && <span className="shrink-0 rounded bg-sunken px-1.5 py-px text-muted">{card.stage}</span>}
              {card.remaining && <span className="truncate text-faint" title={card.remaining}>Left: {card.remaining}</span>}
            </div>
          )}
        </div>
        {live && (
          <button
            onClick={onStop}
            className="flex items-center gap-1 rounded-md border border-line-strong px-2 py-1 text-[12px] text-ink hover:bg-sunken"
          >
            <Icon name="stop" size={12} /> Stop
          </button>
        )}
        <button
          onClick={() => {
            if (window.confirm(`Delete “${card.title}”? Its CLI transcript stays on disk.`)) onDelete();
          }}
          title="Delete card"
          aria-label="Delete card"
          className="rounded-md p-1.5 text-muted hover:bg-sunken hover:text-danger"
        >
          <Icon name="trash" size={15} />
        </button>
        <button
          onClick={onClose}
          title="Close"
          aria-label="Close thread"
          className="rounded-md p-1.5 text-muted hover:bg-sunken hover:text-ink"
        >
          <Icon name="x" size={15} />
        </button>
      </header>

      {card.source === "claude-code" &&
        (card.openElsewhere ? (
          <p className="flex items-center gap-1.5 border-b border-warn/40 bg-warn-soft px-4 py-1.5 text-[11.5px] text-warn">
            <Icon name="alert" size={12} />
            Open in the Claude app right now. Close it there to continue here.
          </p>
        ) : (
          <p className="border-b border-line px-4 py-1.5 text-[11.5px] text-muted">
            Picked up from Claude Code. Replying here continues the same session.
          </p>
        ))}

      <ThreadView card={card} items={items} streaming={streaming} onSend={onSend} onAnswer={onAnswer} />
    </aside>
  );
}
