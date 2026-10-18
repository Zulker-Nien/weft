"use client";

// The open card's thread on weft.zip: the desktop's own message, tool-run and Markdown components
// (ThreadEntries), so a thread reads here the way it does on the Mac, oldest first with "Ran 3
// commands" folded. A reply typed here reaches the Mac that owns the card (lib/cloud-inbox.ts);
// cards a teammate's Mac owns stay read-only here, since only the account's own Mac obeys.
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type { CloudCommandRow } from "@/lib/cloud-commands";
import type { CloudCardRow } from "@/lib/cloud-sync-types";
import { folderName } from "@/lib/format";
import { cardTags } from "@/lib/rail-view";
import type { Card } from "@/lib/types";
import { canReply, cardReplies } from "@/lib/web-commands";
import { chronological, rewriteBlobRefs, seqOf, type WebBoardThread } from "@/lib/web-board";
import BackendBadge from "../BackendBadge";
import CardProgress, { showsCardProgress } from "../CardProgress";
import Icon from "../Icon";
import TagPill from "../TagPill";
import { groupThread, ThreadEntries } from "../ThreadItems";
import { WebReplyBox } from "./WebReplyBox";

// How close to the bottom still counts as "following" the thread, in px.
const FOLLOW_SLACK = 80;

export function WebThreadPanel({
  card,
  ownerDevice,
  cardRow,
  window: thread,
  blobUrls,
  commands,
  userId,
  onClose,
  onLoadOlder,
  onSendReply,
  onDropCommand,
}: {
  card: Card;
  ownerDevice: string;
  cardRow: CloudCardRow;
  window: WebBoardThread;
  blobUrls: Record<string, string>;
  commands: CloudCommandRow[];
  userId: string;
  onClose: () => void;
  onLoadOlder: () => void;
  onSendReply: (text: string) => Promise<string | null>;
  onDropCommand: (id: string) => void;
}) {
  const entries = useMemo(() => groupThread(rewriteBlobRefs(chronological(thread.items), blobUrls)), [thread.items, blobUrls]);
  const scroller = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  // The newest item's seq: it changes when the thread grows, not when "Load earlier" adds above.
  const newest = thread.items[0] ? seqOf(thread.items[0]) : undefined;
  const replies = useMemo(() => cardReplies(commands, card.id), [commands, card.id]);
  const replyAllowed = canReply(cardRow, userId);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // A new card starts at its latest message; the same card keeps following only while you're at the bottom.
  useLayoutEffect(() => {
    following.current = true;
  }, [card.id]);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && following.current) el.scrollTop = el.scrollHeight;
  }, [card.id, newest]);

  const { shown, more } = cardTags(card.tags);
  return (
    <>
      <div className="absolute inset-0 z-30 bg-black/40" onClick={onClose} aria-hidden="true" />
      <aside role="dialog" aria-label={`Thread: ${card.title}`} className="absolute inset-y-0 right-0 z-40 flex w-[min(720px,100%)] flex-col border-l border-line-strong bg-panel shadow-2xl">
        <header className="flex shrink-0 items-start gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="flex items-center gap-2 text-[15px] font-medium leading-snug text-ink">
              {card.emoji && <span aria-hidden>{card.emoji}</span>}
              <span className="min-w-0">{card.title}</span>
            </h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-muted">
              <BackendBadge backend={card.backend} card={card} />
              <span className="font-medium">{folderName(card.cwd)}</span>
              <span className="text-faint">on {ownerDevice}</span>
              {shown.map((tag) => (
                <TagPill key={tag} tag={tag} />
              ))}
              {more > 0 && <span className="text-faint">+{more}</span>}
            </div>
            {showsCardProgress(card) && <CardProgress card={card} marks={null} />}
          </div>
          <button type="button" onClick={onClose} aria-label="Close thread" className="rounded p-1.5 text-muted hover:bg-sunken hover:text-ink">
            <Icon name="x" size={16} />
          </button>
        </header>
        <div
          ref={scroller}
          onScroll={(e) => {
            const el = e.currentTarget;
            following.current = el.scrollHeight - el.scrollTop - el.clientHeight < FOLLOW_SLACK;
          }}
          className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4"
        >
          {thread.hasOlder && (
            <button type="button" onClick={onLoadOlder} className="self-center rounded-md border border-line-strong px-3 py-1 text-[12px] text-muted hover:bg-sunken hover:text-ink">
              Load earlier messages
            </button>
          )}
          {entries.length === 0 && <p className="py-6 text-center text-[12.5px] text-faint">Nothing in this thread has synced yet.</p>}
          <ThreadEntries entries={entries} live={card.column === "running"} streaming="" cardId={card.id} />
        </div>
        <WebReplyBox card={card} canReply={replyAllowed} replies={replies} onSend={onSendReply} onDrop={onDropCommand} />
      </aside>
    </>
  );
}
