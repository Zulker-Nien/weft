"use client";

import { useState } from "react";
import { folderName, isLive } from "@/lib/format";
import { useShortcutHint } from "@/lib/hotkeys";
import type { PlanResets } from "@/lib/schedule";
import type { Card, PermissionMode, ThreadItem } from "@/lib/types";
import { BackendPicker } from "./CardView";
import CrashGuard from "./CrashGuard";
import { guarded } from "./guarded";
import Icon from "./Icon";
import ModePicker from "./ModePicker";
import SkillMenu from "./SkillMenu";
import StarButton from "./StarButton";
import TagPill from "./TagPill";
import { cardTags } from "@/lib/rail-view";
import ThreadView from "./ThreadView";
import CopilotEmpty from "./CopilotEmpty";

// Loaded in its own CrashGuard (components/guarded.tsx), so a broken review panel leaves the thread and its reply box.
const ReviewPanel = guarded(() => import("./ReviewPanel"), { what: "review panel", className: "mx-4 my-2" });

export default function ThreadPanel({
  card,
  items,
  streaming,
  onSend,
  onAnswer,
  onRelease,
  onArchive,
  onStar,
  onTags,
  onDelete,
  onClose,
  onRename,
  onMode,
  onNewChat,
  editTitle = false,
  resets,
}: {
  card: Card;
  items: ThreadItem[];
  streaming: string;
  onSend: (text: string) => Promise<void>;
  onAnswer: (allow: boolean, answers?: Record<string, string>) => void;
  onRelease: () => void;
  onArchive: () => void;
  // The ☆: star or unstar the card.
  onStar?: () => void;
  // A click on the card's tags (or "+ tag"): opens the Tags… dialog.
  onTags?: () => void;
  onDelete: () => void;
  // Left out while the browser shows beside the thread: the window's X sits in the browser's corner.
  onClose?: () => void;
  onRename: (title: string) => void;
  // Applies to the open CLI right away, mid-turn included.
  onMode: (mode: PermissionMode) => void;
  // The copilot's New chat, in place of the board card's skills, star, archive and delete.
  onNewChat?: () => void;
  // Opens with the title already being edited (Rename… in the card's right-click menu).
  editTitle?: boolean;
  // The plan's next 5-hour and weekly resets, the reply box's default Send later times.
  resets: PlanResets;
}) {
  const live = isLive(card);
  // The copilot opens here like any card, but it has no project and isn't filed, starred or renamed.
  const pilot = card.role === "copilot";

  return (
    <aside className="flex w-[44%] min-w-[380px] shrink-0 flex-col bg-panel last:flex-1">
      <header className="flex items-start gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <PanelTitle card={card} editable={!pilot} editTitle={editTitle} onRename={onRename} />
          <HeaderMeta card={card} pilot={pilot} onMode={onMode} onTags={onTags} />
          {(card.stage || card.remaining) && (
            <div className="mt-1.5 flex min-w-0 items-center gap-1.5 text-[11.5px]">
              {card.stage && <span className="shrink-0 rounded bg-sunken px-1.5 py-px text-muted">{card.stage}</span>}
              {card.remaining && <span className="truncate text-faint" title={card.remaining}>Left: {card.remaining}</span>}
            </div>
          )}
        </div>
        {pilot ? (
          <NewChatButton onClick={onNewChat} />
        ) : (
          <CardActions card={card} live={live} onSend={onSend} onStar={onStar} onArchive={onArchive} onDelete={onDelete} />
        )}
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
        {...threadExtras(card, pilot, items, onSend, resets)}
      />
    </aside>
  );
}

// The thread's title; a click renames it (not the copilot's), Enter keeps the new name and Escape drops it.
function PanelTitle({ card, editable, editTitle, onRename }: {
  card: Card;
  editable: boolean;
  editTitle: boolean;
  onRename: (title: string) => void;
}) {
  const [editing, setEditing] = useState(editTitle);
  if (editing && editable) {
    return (
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
    );
  }
  return (
    <h2
      title={editable ? "Click to rename" : undefined}
      onClick={() => setEditing(true)}
      className="line-clamp-2 cursor-text rounded text-[14px] font-medium leading-snug text-ink hover:bg-sunken"
    >
      {card.title}
    </h2>
  );
}

// Under the title: the CLI, its mode, the folder (the copilot covers the whole board), the session and its tags.
function HeaderMeta({ card, pilot, onMode, onTags }: {
  card: Card;
  pilot: boolean;
  onMode: (mode: PermissionMode) => void;
  onTags?: () => void;
}) {
  return (
    <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-muted">
      <BackendPicker card={card} />
      <CrashGuard inline what="mode picker"><ModePicker small backend={card.backend} value={card.permissionMode} onChange={onMode} yolo={card.backend !== "puku" && !pilot} disabled={card.backend === "codex" && Boolean(card.sessionId)} /></CrashGuard>
      <span className="min-w-[3rem] truncate" title={card.cwd}>{pilot ? "✨ whole board" : folderName(card.cwd)}</span>
      {card.sessionId && (
        <span className="shrink-0 whitespace-nowrap font-mono text-faint" title={card.sessionId}>· {card.sessionId.slice(0, 8)}</span>
      )}
      {card.warm && (
        <span className="shrink-0 whitespace-nowrap text-ok" title="The CLI is open, so a reply starts right away">· live</span>
      )}
      <HeaderMarks card={card} onTags={pilot ? undefined : onTags} />
    </div>
  );
}

// What the thread shows that differs for the copilot: no review panel or Send later, a few suggestions to start.
function threadExtras(card: Card, pilot: boolean, items: ThreadItem[], onSend: (text: string) => Promise<void>, resets: PlanResets) {
  if (pilot) {
    return {
      empty: <CopilotEmpty onAsk={(text) => void onSend(text).catch(() => {})} />,
      placeholder: "Ask about your threads, or tell me what to start",
    };
  }
  return {
    footer: card.column === "review" && <ReviewPanel card={card} items={items} onSend={onSend} />,
    replaceReply: card.column === "review" && Boolean(card.review),
    scheduling: { resets },
  };
}

// A board card's header buttons: its skills, star, archive and delete.
function CardActions({ card, live, onSend, onStar, onArchive, onDelete }: {
  card: Card;
  live: boolean;
  onSend: (text: string) => Promise<void>;
  onStar?: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const hint = useShortcutHint();
  return (
    <>
      <CrashGuard inline what="skill menu"><SkillMenu cwd={card.cwd} disabled={live} onRun={(skill) => onSend(`/${skill}`)} /></CrashGuard>
      <CrashGuard inline what="star"><StarButton variant="header" starred={Boolean(card.starred)} onClick={onStar} /></CrashGuard>
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
    </>
  );
}

// Starts the copilot over with an empty conversation.
function NewChatButton({ onClick }: { onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      title="Start a new conversation"
      className="shrink-0 rounded-md px-2 py-1 text-[11.5px] text-muted hover:bg-sunken hover:text-ink"
    >
      New chat
    </button>
  );
}

// The card's GitHub issue (#N, a link) and its tags, which open the Tags… dialog ("+ tag" with none yet).
function HeaderMarks({ card, onTags }: { card: Card; onTags?: () => void }) {
  return (
    <>
      {card.issue && (
        <a href={card.issue.url} target="_blank" rel="noreferrer" title={`${card.issue.repo}#${card.issue.number} (${card.issue.state})`} className="shrink-0 font-medium text-muted hover:underline">
          #{card.issue.number}
        </a>
      )}
      {onTags && (
        <button
          type="button"
          onClick={onTags}
          title="Edit tags"
          aria-label={card.tags?.length ? `Tags: ${card.tags.join(", ")}` : "Add a tag"}
          className="flex shrink-0 items-center gap-1 rounded px-0.5 hover:bg-sunken"
        >
          {card.tags?.length ? <HeaderTags tags={card.tags} /> : <span className="whitespace-nowrap text-faint">+ tag</span>}
        </button>
      )}
    </>
  );
}

// Up to three tags, then "+N".
function HeaderTags({ tags }: { tags: string[] }) {
  const { shown, more } = cardTags(tags, 3);
  return (
    <>
      {shown.map((tag) => (
        <TagPill key={tag} tag={tag} className="max-w-[80px]" />
      ))}
      {more > 0 && <span className="text-faint">+{more}</span>}
    </>
  );
}
