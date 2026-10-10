"use client";

import { useState } from "react";
import { folderName, isLive } from "@/lib/format";
import type { Card, ThreadItem } from "@/lib/types";
import { BackendBadge } from "./CardView";
import Icon from "./Icon";
import ReviewPanel from "./ReviewPanel";
import SkillMenu from "./SkillMenu";
import ThreadView from "./ThreadView";

export default function ThreadPanel({
  card,
  items,
  streaming,
  onSend,
  onAnswer,
  onStop,
  onRelease,
  onArchive,
  onDelete,
  onClose,
  onRename,
  alsoHere,
  resetAt,
}: {
  card: Card;
  items: ThreadItem[];
  streaming: string;
  onSend: (text: string) => Promise<void>;
  onAnswer: (allow: boolean, answers?: Record<string, string>) => void;
  onStop: () => void;
  onRelease: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onClose: () => void;
  onRename: (title: string) => void;
  // Other busy cards in this folder (lib/overlap.ts busyHere).
  alsoHere?: Card[];
  // The plan's next 5-hour reset (unix ms), the reply box's default Send later time.
  resetAt?: number;
}) {
  const [editing, setEditing] = useState(false);
  const live = isLive(card);

  return (
    <aside className="flex w-[44%] min-w-[380px] shrink-0 flex-col bg-panel last:flex-1">
      <header className="flex items-start gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          {editing ? (
            <input
              autoFocus
              defaultValue={card.title}
              onFocus={(e) => e.currentTarget.select()}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") {
                  // Cancels the rename only; the thread stays open.
                  e.stopPropagation();
                  e.currentTarget.value = card.title;
                  e.currentTarget.blur();
                }
              }}
              onBlur={(e) => {
                const title = e.currentTarget.value.trim();
                setEditing(false);
                if (title && title !== card.title) onRename(title);
              }}
              className="w-full rounded border border-accent bg-panel px-1 py-0.5 text-[14px] font-medium leading-snug text-ink outline-none"
            />
          ) : (
            <h2
              title="Click to rename"
              onClick={() => setEditing(true)}
              className="line-clamp-2 cursor-text rounded text-[14px] font-medium leading-snug text-ink hover:bg-sunken"
            >
              {card.title}
            </h2>
          )}
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
        <SkillMenu cwd={card.cwd} disabled={live} onRun={(skill) => onSend(`/${skill}`)} />
        {live && (
          <button
            onClick={onStop}
            className="flex items-center gap-1 rounded-md border border-line-strong px-2 py-1 text-[12px] text-ink hover:bg-sunken"
          >
            <Icon name="stop" size={12} /> Stop
          </button>
        )}
        <button
          onClick={onArchive}
          disabled={live}
          title={card.archived ? "Unarchive card" : "Archive card"}
          aria-label={card.archived ? "Unarchive card" : "Archive card"}
          className="rounded-md p-1.5 text-muted hover:bg-sunken hover:text-ink disabled:opacity-40"
        >
          <Icon name="archive" size={15} />
        </button>
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
            <span className="min-w-0 flex-1">Open in the Claude app or a terminal right now.</span>
            <button
              onClick={onRelease}
              title="Stop the Claude CLI that has this thread open, so replies continue here"
              className="shrink-0 rounded px-1.5 py-0.5 font-medium underline underline-offset-2 hover:bg-warn/15"
            >
              Click here to continue
            </button>
          </p>
        ) : (
          <p className="border-b border-line px-4 py-1.5 text-[11.5px] text-muted">
            Picked up from Claude Code. Replying here continues the same session.
          </p>
        ))}

      <ThreadView
        card={card}
        items={items}
        streaming={streaming}
        onSend={onSend}
        onAnswer={onAnswer}
        footer={card.column === "review" && <ReviewPanel card={card} items={items} onSend={onSend} />}
        replaceReply={card.column === "review" && Boolean(card.review)}
        alsoHere={alsoHere}
        scheduling={{ resetAt }}
      />
    </aside>
  );
}
