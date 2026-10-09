"use client";

import { useEffect, useRef, useState } from "react";
import Composer, { type ComposerHandle } from "./Composer";
import Icon, { Spinner } from "./Icon";
import StatusStrip from "./StatusStrip";
import type { CardStats } from "@/lib/types";

// What you were writing to a card, kept per card until it's sent.
const draftKey = (cardId: string) => `weft.reply.${cardId}`;

function readDraft(cardId: string) {
  try {
    return localStorage.getItem(draftKey(cardId)) ?? "";
  } catch {
    return "";
  }
}

function writeDraft(cardId: string, markdown: string) {
  try {
    if (markdown.trim()) localStorage.setItem(draftKey(cardId), markdown);
    else localStorage.removeItem(draftKey(cardId));
  } catch {}
}

// A thread's reply box: the same composer as a new thread (Markdown, pasted images and videos,
// dictation), sized for a reply. Enter sends; Shift+Enter starts a new line.
export default function ReplyBox({
  cardId,
  cwd,
  stats,
  live,
  placeholder,
  onSend,
}: {
  cardId: string;
  cwd: string;
  stats?: CardStats;
  // A turn is running or waiting on a permission answer, so a reply can't go yet.
  live: boolean;
  placeholder: string;
  onSend: (text: string) => Promise<void>;
}) {
  const [initial] = useState(() => readDraft(cardId));
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Messages written while the thread was working; they go out together once the turn ends.
  const [queue, setQueue] = useState<string[]>([]);
  const wasLive = useRef(live);
  const composer = useRef<ComposerHandle>(null);
  const draftTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(draftTimer.current), []);

  // The turn just ended: send what was queued as one message.
  useEffect(() => {
    const ended = wasLive.current && !live;
    wasLive.current = live;
    if (!ended || queue.length === 0) return;
    const text = queue.join("\n\n");
    setQueue([]);
    onSend(text).catch((err) => {
      setQueue((q) => [text, ...q]);
      setError(err instanceof Error ? err.message : String(err));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);

  async function submit() {
    if (sending) return;
    let text: string;
    try {
      text = composer.current?.read() ?? "";
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return;
    }
    if (!text) {
      setError("Write a message first.");
      return;
    }
    if (live) {
      setQueue((q) => [...q, text]);
      clearTimeout(draftTimer.current);
      writeDraft(cardId, "");
      composer.current?.clear();
      return;
    }
    setSending(true);
    try {
      await onSend(text);
      clearTimeout(draftTimer.current);
      writeDraft(cardId, "");
      composer.current?.clear();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="border-t border-line p-3">
      {queue.length > 0 && (
        <ul className="mb-2 flex flex-col gap-1">
          {queue.map((text, i) => (
            <li
              key={i}
              className="flex items-center gap-2 rounded-md bg-sunken px-2.5 py-1.5 text-[12.5px] text-muted"
            >
              <span className="shrink-0 text-[11px] uppercase tracking-wide">Queued</span>
              <span className="min-w-0 flex-1 truncate">{text}</span>
              <button
                type="button"
                onClick={() => setQueue((q) => q.filter((_, j) => j !== i))}
                aria-label="Remove queued message"
                className="shrink-0 hover:text-ink"
              >
                <Icon name="x" size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <Composer
        ref={composer}
        variant="reply"
        cwd={cwd}
        initial={initial}
        placeholder={live ? "Working. Write the next message and it'll send when this turn is done." : placeholder}
        onSubmit={() => void submit()}
        onChange={(markdown) => {
          setError(null);
          clearTimeout(draftTimer.current);
          draftTimer.current = setTimeout(() => writeDraft(cardId, markdown), 300);
        }}
        sizeClass="min-h-[44px] max-h-[40vh]"
        actions={
          <button
            type="button"
            onClick={() => void submit()}
            disabled={sending}
            aria-label="Send"
            title={live ? "Queue until the turn finishes (Enter)" : "Send (Enter)"}
            className="ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent text-on-accent hover:opacity-90 disabled:opacity-40"
          >
            {sending ? <Spinner size={13} /> : <Icon name="send" size={15} />}
          </button>
        }
      />
      <StatusStrip stats={stats} cwd={cwd} className="mt-1.5 px-1" />
      {error && <p className="mt-1.5 text-[12px] text-danger">{error}</p>}
    </div>
  );
}
