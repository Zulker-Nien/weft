"use client";

import { useState } from "react";
import { folderName, isLive } from "@/lib/format";
import { useShortcutHint } from "@/lib/hotkeys";
import type { PlanResets } from "@/lib/schedule";
import type { Card, PermissionMode, ThreadItem } from "@/lib/types";
import { BackendBadge } from "./CardView";
import Icon from "./Icon";
import ModePicker from "./ModePicker";
import ReviewPanel from "./ReviewPanel";
import SkillMenu from "./SkillMenu";
import StarButton from "./StarButton";
import ThreadView from "./ThreadView";

export default function ThreadPanel({
  card,
  items,
  streaming,
  onSend,
  onAnswer,
  onRelease,
  onArchive,
  onStarMenu,
  onDelete,
  onClose,
  onRename,
  onMode,
  editTitle = false,
  alsoHere,
  resets,
}: {
  card: Card;
  items: ThreadItem[];
  streaming: string;
  onSend: (text: string) => Promise<void>;
  onAnswer: (allow: boolean, answers?: Record<string, string>) => void;
  onRelease: () => void;
  onArchive: () => void;
  // The ☆: file the card in the library, or show or unstar it.
  onStarMenu?: (e: React.MouseEvent) => void;
  onDelete: () => void;
  // Left out while the browser shows beside the thread: the window's X sits in the browser's corner.
  onClose?: () => void;
  onRename: (title: string) => void;
  // Applies to the open CLI right away, mid-turn included.
  onMode: (mode: PermissionMode) => void;
  // Opens with the title already being edited (Rename… in the card's right-click menu).
  editTitle?: boolean;
  // Other busy cards in this folder (lib/overlap.ts busyHere).
  alsoHere?: Card[];
  // The plan's next 5-hour and weekly resets, the reply box's default Send later times.
  resets: PlanResets;
}) {
  const [editing, setEditing] = useState(editTitle);
  const hint = useShortcutHint();
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
            <ModePicker small value={card.permissionMode} onChange={onMode} yolo={card.backend === "claude"} />
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
        <StarButton variant="header" starred={Boolean(card.libraryId)} onClick={onStarMenu} />
        <button
          onClick={onArchive}
          disabled={live}
          title={hint("archive", card.archived ? "Unarchive card" : "Archive card")}
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
        {onClose && (
          <button
            onClick={onClose}
            title="Close (Esc)"
            aria-label="Close thread"
            className="rounded-md p-1.5 text-muted hover:bg-sunken hover:text-ink"
          >
            <Icon name="x" size={15} />
          </button>
        )}
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
        scheduling={{ resets }}
      />
    </aside>
  );
}
