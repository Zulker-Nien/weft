"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "@/lib/client";
import { isLive } from "@/lib/format";
import { onScrollToTurn, pulse, reportTopTurn, topmostTurn, turnRow, PULSE_MS } from "@/lib/glance-events";
import type { PlanResets } from "@/lib/schedule";
import { THREAD_PAGE_SIZE } from "@/lib/cloud-sync-types";
import { applyThreadEvent, mergeOlderPage, pageThread, type ThreadPage } from "@/lib/thread-page";
import type { BoardEvent, Card, QuestionReply, ThreadItem } from "@/lib/types";
import { useBoardEvents } from "@/lib/use-events";
import { useEditLast } from "@/lib/use-edit-last";
import CrashGuard from "./CrashGuard";
import { guarded } from "./guarded";
import Icon, { Spinner } from "./Icon";
import PermissionInput, { PermissionActions } from "./PermissionInput";
import StatusStrip from "./StatusStrip";
import { ThreadEntries, groupThread } from "./ThreadItems";

// Loaded in its own CrashGuard (components/guarded.tsx): a reply box that fails, even as its module loads,
// leaves the thread readable.
const ReplyBox = guarded(() => import("./ReplyBox"), { what: "reply box", className: "mx-4 my-2" });

// A pending question, for the reply box, whose composer is where you type your own answer or a note.
function questionFor(card: Card, onAnswer: (allow: boolean, answers?: Record<string, string>, reply?: QuestionReply) => void) {
  const pending = card.pending;
  if (!pending?.questions) return undefined;
  return {
    key: pending.id,
    questions: pending.questions,
    readScope: pending.readScope,
    previewUrl: pending.previewUrl,
    onAnswer: (answers: Record<string, string>, annotations: NonNullable<QuestionReply["annotations"]>) => {
      onAnswer(true, answers, Object.keys(annotations).length ? { annotations } : undefined);
    },
    // Persist the read scope and queue the /add-dir slash command; the form answers the question itself.
    onReadScope: (path: string) => void api.setReadScope(card.id, path).catch(() => {}),
  };
}

// A thread's messages, its pending permission request, and the reply box.
// The parent supplies a flex column for it to fill.
export default function ThreadView({
  card,
  items,
  streaming,
  onSend,
  onAnswer,
  empty,
  placeholder = "Reply to continue this thread",
  footer,
  replaceReply = false,
  scheduling,
}: {
  card: Card;
  // The full thread snapshot from the parent; used as the seed on first connect and on reconnect,
  // so the page can recover when the live stream is between events.
  items: ThreadItem[];
  streaming: string;
  onSend: (text: string) => Promise<void>;
  // reply: a question's notes.
  onAnswer: (allow: boolean, answers?: Record<string, string>, reply?: QuestionReply) => void;
  empty?: ReactNode;
  placeholder?: string;
  // Shown above the reply box, or in its place with replaceReply.
  footer?: ReactNode;
  replaceReply?: boolean;
  // Given on board threads, so the reply box offers Send later; resets are the plan's next 5-hour and weekly resets.
  scheduling?: { resets: PlanResets };
}) {
  // The request already answered here, so a second click can't answer it (or the next one) again.
  const [answeredId, setAnsweredId] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const live = isLive(card);
  // The page is the source of truth for what's drawn. It starts as the parent's `items` snapshot
  // (newest THREAD_PAGE_SIZE) so first paint isn't blank; the server fetch then takes over.
  const [page, setPage] = useState<ThreadPage>(() => pageThread(items, { limit: THREAD_PAGE_SIZE }));
  const [loadingOlder, setLoadingOlder] = useState(false);
  const answered = answeredId !== null && answeredId === card.pending?.id;
  const { editLast, editFrom, onEditing } = useEditLast(card, page.items, () => (stick.current = true));
  const question = questionFor(card, onAnswer);

  // Fetch one page of the thread, newest (`before` omitted) or older (with `before=start`).
  const loadPage = useCallback(async (before?: number) => {
    const params = new URLSearchParams();
    if (before !== undefined) params.set("before", String(before));
    params.set("limit", String(THREAD_PAGE_SIZE));
    const res = await fetch(`/api/cards/${card.id}/thread?${params.toString()}`);
    if (!res.ok) return;
    const data = (await res.json()) as ThreadPage;
    setPage((prev) => (before === undefined ? data : mergeOlderPage(prev, data)));
  }, [card.id]);

  // On card change, fetch the newest page. The seed above covers the first paint; a microtask keeps
  // the setState out of the effect's synchronous render path (eslint: react-hooks/set-state-in-effect).
  useEffect(() => {
    if (!card.id) return;
    queueMicrotask(() => void loadPage().catch(() => {}));
  }, [card.id, loadPage]);

  // Live events: translate the absolute index to a local one in the loaded window.
  useBoardEvents(
    (event: BoardEvent) => {
      if (event.type === "thread_cleared" && event.cardId === card.id) setPage({ items: [], start: 0, total: 0 });
      if (event.type !== "thread" || event.cardId !== card.id) return;
      setPage((prev) => applyThreadEvent(prev, event));
    },
    () => {
      // Reconnect: re-pull the newest page so we self-heal any missed events.
      loadPage().catch(() => {});
    },
  );

  // Follow new output unless the user has scrolled up to read.
  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [page.items, streaming, card.pending]);

  // Images load after the text and push it up; keep following the bottom while they do.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const follow = () => {
      if (stick.current) el.scrollTop = el.scrollHeight;
    };
    el.addEventListener("load", follow, true);
    return () => el.removeEventListener("load", follow, true);
  }, []);

  // The glance rail (components/GlanceRail.tsx): a clicked mini scrolls here, and a scroll of our own
  // tells the rail which turn is now on top, at most once per 80 ms. A rail-driven scroll doesn't echo back.
  const railScroll = useRef(0);
  const reportTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const lastTop = useRef<string>(undefined);
  useEffect(() => {
    const off = onScrollToTurn((id) => {
      const el = scroller.current;
      const row = el && turnRow(el, id);
      if (!row) return;
      stick.current = false;
      lastTop.current = id;
      railScroll.current = Date.now() + PULSE_MS + 200;
      row.scrollIntoView({ block: "start", behavior: "smooth" });
      pulse(row);
    });
    return () => {
      off();
      clearTimeout(reportTimer.current);
    };
  }, []);

  function reportTop(el: HTMLElement) {
    clearTimeout(reportTimer.current);
    reportTimer.current = setTimeout(() => {
      if (Date.now() < railScroll.current) return;
      const id = topmostTurn(el);
      if (!id || id === lastTop.current) return;
      lastTop.current = id;
      reportTopTurn(id);
    }, 80);
  }

  // The user scrolled near the top of the loaded window: ask the server for the page that ends at
  // `start`. If the request returns more items, prepend them and adjust scrollTop by the height
  // they added, so the row the user was looking at stays put.
  async function loadOlder(before: number) {
    if (loadingOlder || before <= 0) return;
    setLoadingOlder(true);
    const el = scroller.current;
    const beforeHeight = el?.scrollHeight ?? 0;
    try {
      await loadPage(before);
    } finally {
      setLoadingOlder(false);
      // After the prepend, scrollTop must be shifted by the height the older rows added.
      requestAnimationFrame(() => {
        const after = scroller.current;
        if (after) after.scrollTop = after.scrollTop + (after.scrollHeight - beforeHeight);
      });
    }
  }

  function answer(allow: boolean) {
    if (!card.pending || answered) return;
    setAnsweredId(card.pending.id);
    onAnswer(allow);
  }

  async function send(text: string) {
    await onSend(text);
    stick.current = true;
  }

  const entries = groupThread(page.items);

  return (
    <>
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          // "Near the top" means the scroll is within one page of the start; load the next older page.
          if (el.scrollTop < 80 && page.start > 0 && !loadingOlder) {
            void loadOlder(page.start);
          }
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          reportTop(el);
        }}
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4"
      >
        {page.start > 0 && (
          <div className="self-center text-[11px] text-faint">
            {loadingOlder ? <Spinner size={10} /> : "Scroll up for earlier messages"}
          </div>
        )}
        {entries.length === 0 && !live && empty}
        <ThreadEntries entries={entries} live={live} streaming={streaming} editFrom={editFrom} onSend={send} cardId={card.id} />
        {card.column === "running" && !streaming && (
          <div className="flex items-center gap-2 text-[12px] text-muted">
            <Spinner size={12} /> Working…
          </div>
        )}
        {card.error && !live && (
          <div className="rounded-md bg-danger-soft px-3 py-2 font-mono text-[12px] text-danger">{card.error}</div>
        )}
      </div>

      {card.pending && !card.pending.questions && (
        <CrashGuard key={card.pending.id} what="permission request" className="mx-4 my-2">
        <div className="flex shrink-0 flex-col border-t border-warn/40 bg-warn-soft px-4 py-3">
          <div className="flex items-start gap-2 text-[13px] font-medium text-ink">
            <Icon name="lock" size={14} className="mt-0.5 text-warn" />
            <span>{card.pending.title}</span>
          </div>
          <PermissionInput input={card.pending.input} edit={card.pending.edit} askedBy={card.title} why={card.pending.why} />
          <PermissionActions
            pending={card.pending}
            answered={answered}
            onAnswer={answer}
            onWait={() => card.pending && void api.waitPermission(card.id, card.pending.id).catch(() => {})}
          />
        </div>
        </CrashGuard>
      )}

      {footer}
      {(!replaceReply || question) && (
        <ReplyBox key={card.id} question={question} cardId={card.id} cwd={card.cwd} live={live} placeholder={placeholder} suggestion={card.suggestion}
          sendLater={scheduling && { backend: card.backend, resets: scheduling.resets, scheduled: card.scheduled ?? [] }}
          status={<StatusStrip stats={card.stats} cwd={card.cwd} backend={card.backend} />}
          editLast={editLast} onEditing={onEditing}
          onSend={send} onShell={(command) => api.shell(card.id, command).then(() => {})} onStop={() => api.stop(card.id).then(() => {})} />
      )}
    </>
  );
}
