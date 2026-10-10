"use client";

import { useEffect, useRef, useState } from "react";
import { alsoHereLine } from "@/lib/overlap";
import type { Card } from "@/lib/types";
import Composer, { type ComposerHandle } from "./Composer";
import Icon, { Spinner } from "./Icon";

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
  live,
  placeholder,
  alsoHere = [],
  onSend,
  onStop,
}: {
  cardId: string;
  cwd: string;
  // Other busy cards in this folder: they share the working tree (lib/overlap.ts).
  alsoHere?: Card[];
  // A turn is running or waiting on a permission answer, so a reply can't go yet.
  live: boolean;
  placeholder: string;
  onSend: (text: string) => Promise<void>;
  onStop: () => Promise<void>;
}) {
  const [initial] = useState(() => readDraft(cardId));
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Messages written while the thread was working; they go out together once the turn ends.
  const [queue, setQueue] = useState<string[]>([]);
  // Held while you edit a message pulled back out of the queue (or after a queued send failed).
  const [paused, setPaused] = useState(false);
  const composer = useRef<ComposerHandle>(null);
  const draftTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(draftTimer.current), []);

  // The turn ended and nothing is being edited: send what was queued as one message.
  useEffect(() => {
    if (live || paused || queue.length === 0) return;
    const text = queue.join("\n\n");
    // Cleared in the same pass as the send, so a re-run of this effect can't send the queue twice.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQueue([]);
    onSend(text).catch((err) => {
      setQueue((q) => [text, ...q]);
      setPaused(true);
      setError(err instanceof Error ? err.message : String(err));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, paused, queue]);

  async function submit(now = false) {
    if (sending) return;
    let text: string;
    try {
      text = composer.current?.read() ?? "";
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return;
    }
    if (!text && paused && queue.length > 0) {
      setPaused(false);
      return;
    }
    if (!text) {
      setError("Write a message first.");
      return;
    }
    if (live && !now) {
      setQueue((q) => [...q, text]);
      setPaused(false);
      clearTimeout(draftTimer.current);
      writeDraft(cardId, "");
      composer.current?.clear();
      return;
    }
    setSending(true);
    try {
      // Send now: interrupt the running turn first, then the message goes out as the next one.
      if (live) await onStop();
      await onSend(text);
      setPaused(false);
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
    <div
      className="border-t border-line p-3"
      onKeyDownCapture={(e) => {
        // Up in an empty box pulls the last queued message back to edit; the queue holds meanwhile.
        if (e.key === "ArrowUp" && queue.length > 0 && composer.current?.isEmpty()) {
          e.preventDefault();
          e.stopPropagation();
          composer.current.write(queue[queue.length - 1]);
          setQueue((q) => q.slice(0, -1));
          setPaused(true);
        }
      }}
      onKeyDown={(e) => {
        // Ctrl+C stops the running turn, unless text is selected (then it's a copy).
        if (live && e.ctrlKey && !e.metaKey && e.key.toLowerCase() === "c" && !window.getSelection()?.toString()) {
          e.preventDefault();
          void onStop().catch((err) => setError(err instanceof Error ? err.message : String(err)));
        }
      }}
    >
      {alsoHere.length > 0 && (
        <p
          className="mb-1.5 flex min-w-0 items-center gap-1.5 text-[11.5px] text-warn"
          title={`These threads share this folder's working tree:\n${alsoHere.map((c) => c.title).join("\n")}`}
        >
          <Icon name="alert" size={12} className="shrink-0" />
          <span className="truncate">{alsoHereLine(alsoHere)}</span>
        </p>
      )}
      {queue.length > 0 && (
        <ul className="mb-2 flex flex-col gap-1">
          {queue.map((text, i) => (
            <li
              key={i}
              className="flex items-center gap-2 rounded-md bg-sunken px-2.5 py-1.5 text-[12.5px] text-muted"
            >
              <span className="shrink-0 text-[11px] uppercase tracking-wide">{paused ? "Paused" : "Queued"}</span>
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
          <>
            {live && (
              <button
                type="button"
                onClick={() => void submit(true)}
                disabled={sending}
                title="Stop the current turn and send this now"
                className="ml-1 shrink-0 rounded-md border border-line-strong px-2 py-1 text-[12px] text-ink hover:bg-sunken disabled:opacity-40"
              >
                Send now
              </button>
            )}
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
          </>
        }
      />
      {error && <p className="mt-1.5 text-[12px] text-danger">{error}</p>}
    </div>
  );
}
