"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { formatCost, isLive, shortToolName } from "@/lib/format";
import type { Card, ThreadItem } from "@/lib/types";
import Icon, { Spinner } from "./Icon";
import QuestionForm from "./QuestionForm";

// Links open in the side browser pane when running in the desktop app.
function Linkified({ text }: { text: string }) {
  const parts: ReactNode[] = text.split(/(https?:\/\/[^\s)>\]"'`]+)/g).map((part, i) =>
    i % 2 === 1 ? (
      <a key={i} href={part} target="_blank" rel="noreferrer" className="text-accent underline underline-offset-2">
        {part}
      </a>
    ) : (
      part
    ),
  );
  return <>{parts}</>;
}

function Item({ item }: { item: ThreadItem }) {
  switch (item.kind) {
    case "user":
      return (
        <div className="ml-10 whitespace-pre-wrap rounded-lg bg-accent-soft px-3 py-2 text-[13.5px] leading-relaxed text-ink">
          {item.text}
        </div>
      );
    case "assistant":
      return (
        <div className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink">
          <Linkified text={item.text} />
        </div>
      );
    case "tool":
      return (
        <details className="rounded-md border border-line bg-sunken">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-2.5 py-1.5 text-[12px]">
            <Icon name="wrench" size={12} className="text-faint" />
            <span className="shrink-0 font-mono font-medium text-ink">{shortToolName(item.name)}</span>
            <span className="min-w-0 flex-1 truncate font-mono text-muted">{item.summary}</span>
            {item.result === undefined ? (
              <span className="text-faint"><Spinner size={10} /></span>
            ) : item.isError ? (
              <span className="text-danger">failed</span>
            ) : null}
          </summary>
          {item.result && (
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap border-t border-line px-2.5 py-2 font-mono text-[11.5px] leading-snug text-muted">
              {item.result}
            </pre>
          )}
        </details>
      );
    case "permission":
      return (
        <div className="flex items-start gap-2 text-[12px]">
          <Icon name="lock" size={12} className={`mt-0.5 ${item.decision ? "text-faint" : "text-warn"}`} />
          <span className="min-w-0 flex-1 text-muted">{item.title}</span>
          <span
            className={
              item.decision === "allow" ? "text-ok" : item.decision === "deny" ? "text-danger" : "text-warn"
            }
          >
            {item.answer ? `Answered: ${item.answer}` : item.decision === "allow" ? "Allowed" : item.decision === "deny" ? "Denied" : "Waiting for you"}
          </span>
        </div>
      );
    case "result": {
      const cost = formatCost(item.costUsd);
      return (
        <div className="flex items-center gap-2 py-1 text-[11px] text-faint">
          <div className="h-px flex-1 bg-line" />
          {item.isError ? <span className="text-danger">{item.text}</span> : <span>{item.text === "Stopped" ? "Stopped" : "Turn finished"}</span>}
          {cost && <span>· {cost} so far</span>}
          <div className="h-px flex-1 bg-line" />
        </div>
      );
    }
  }
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
}: {
  card: Card;
  items: ThreadItem[];
  streaming: string;
  onSend: (text: string) => Promise<void>;
  onAnswer: (allow: boolean, answers?: Record<string, string>) => void;
  empty?: ReactNode;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The request already answered here, so a second click can't answer it (or the next one) again.
  const [answeredId, setAnsweredId] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const live = isLive(card);
  const visible = items.filter(Boolean);
  const answered = answeredId !== null && answeredId === card.pending?.id;

  // Follow new output unless the user has scrolled up to read.
  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [items, streaming, card.pending]);

  function answer(allow: boolean) {
    if (!card.pending || answered) return;
    setAnsweredId(card.pending.id);
    onAnswer(allow);
  }

  async function submit() {
    const text = draft.trim();
    if (!text) {
      setError("Write a message first.");
      return;
    }
    if (live) return;
    setSending(true);
    try {
      await onSend(text);
      setDraft("");
      stick.current = true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
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
        {visible.length === 0 && !live && empty}
        {visible.map((item, i) => (
          <Item key={i} item={item} />
        ))}
        {streaming && (
          <div className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink">
            {streaming}
            <span className="ml-0.5 animate-pulse text-accent">▍</span>
          </div>
        )}
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

      <div className="border-t border-line p-3">
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
            rows={2}
            placeholder={live ? "Working. Stop it to reply." : placeholder}
            className="min-h-[44px] flex-1 resize-none rounded-md border border-line-strong bg-canvas px-3 py-2 text-[13px] text-ink outline-none placeholder:text-faint focus:border-accent"
          />
          <button
            onClick={() => void submit()}
            disabled={live || sending}
            aria-label="Send"
            className="flex h-[44px] w-[44px] items-center justify-center rounded-md bg-accent text-on-accent hover:opacity-90 disabled:opacity-40"
          >
            {sending ? <Spinner size={14} /> : <Icon name="send" size={16} />}
          </button>
        </div>
        {error && <p className="mt-1.5 text-[12px] text-danger">{error}</p>}
      </div>
    </>
  );
}
