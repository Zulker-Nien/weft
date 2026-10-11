"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "@/lib/client";
import { isLive } from "@/lib/format";
import type { PlanResets } from "@/lib/schedule";
import type { Card, ThreadItem } from "@/lib/types";
import Icon, { Spinner } from "./Icon";
import Markdown from "./Markdown";
import QuestionForm from "./QuestionForm";
import ReplyBox from "./ReplyBox";
import StatusStrip from "./StatusStrip";
import { ThreadMessage, ToolRun, groupThread } from "./ThreadItems";

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
  alsoHere,
  scheduling,
}: {
  card: Card;
  items: ThreadItem[];
  streaming: string;
  onSend: (text: string) => Promise<void>;
  onAnswer: (allow: boolean, answers?: Record<string, string>) => void;
  empty?: ReactNode;
  placeholder?: string;
  // Shown above the reply box, or in its place with replaceReply.
  footer?: ReactNode;
  replaceReply?: boolean;
  // Other busy cards in this folder, warned about above the reply box.
  alsoHere?: Card[];
  // Given on board threads, so the reply box offers Send later; resets are the plan's next 5-hour and weekly resets.
  scheduling?: { resets: PlanResets };
}) {
  // The request already answered here, so a second click can't answer it (or the next one) again.
  const [answeredId, setAnsweredId] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const live = isLive(card);
  const entries = groupThread(items);
  const answered = answeredId !== null && answeredId === card.pending?.id;

  // Follow new output unless the user has scrolled up to read.
  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [items, streaming, card.pending]);

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

  function answer(allow: boolean) {
    if (!card.pending || answered) return;
    setAnsweredId(card.pending.id);
    onAnswer(allow);
  }

  async function send(text: string) {
    await onSend(text);
    stick.current = true;
  }

  return (
    <>
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4"
      >
        {entries.length === 0 && !live && empty}
        {entries.map((entry) =>
          entry.kind === "tools" ? (
            <ToolRun key={entry.key} calls={entry.calls} live={live} />
          ) : (
            <ThreadMessage key={entry.key} item={entry.item} />
          ),
        )}
        {streaming && <Markdown text={streaming} streaming />}
        {card.column === "running" && !streaming && (
          <div className="flex items-center gap-2 text-[12px] text-muted">
            <Spinner size={12} /> Working…
          </div>
        )}
        {card.error && !live && (
          <div className="rounded-md bg-danger-soft px-3 py-2 font-mono text-[12px] text-danger">{card.error}</div>
        )}
      </div>

      {card.pending && (
        <div className="border-t border-warn/40 bg-warn-soft px-4 py-3">
          <div className="flex items-start gap-2 text-[13px] font-medium text-ink">
            <Icon name={card.pending.questions ? "alert" : "lock"} size={14} className="mt-0.5 text-warn" />
            <span>{card.pending.questions ? "The agent has a question" : card.pending.title}</span>
          </div>
          {card.pending.questions ? (
            <div className="mt-2.5">
              <QuestionForm
                key={card.pending.id}
                questions={card.pending.questions}
                onAnswer={(answers) => onAnswer(true, answers)}
                onSkip={() => onAnswer(false)}
              />
            </div>
          ) : (
          <>
          <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap rounded bg-panel/70 px-2 py-1.5 font-mono text-[11px] text-muted">
            {JSON.stringify(card.pending.input, null, 2)}
          </pre>
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => answer(true)}
              disabled={answered}
              className="rounded-md bg-accent px-3 py-1.5 text-[12.5px] font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
            >
              Allow
            </button>
            <button
              onClick={() => answer(false)}
              disabled={answered}
              className="rounded-md border border-line-strong bg-panel px-3 py-1.5 text-[12.5px] text-ink hover:bg-sunken disabled:opacity-50"
            >
              Deny
            </button>
          </div>
          </>
          )}
        </div>
      )}

      {footer}
      {!replaceReply && (
        <ReplyBox key={card.id} cardId={card.id} cwd={card.cwd} live={live} placeholder={placeholder} suggestion={card.suggestion} alsoHere={alsoHere}
          sendLater={scheduling && { backend: card.backend, resets: scheduling.resets, scheduled: card.scheduled ?? [] }}
          status={<StatusStrip stats={card.stats} cwd={card.cwd} backend={card.backend} />}
          onSend={send} onStop={() => api.stop(card.id).then(() => {})} />
      )}
    </>
  );
}
