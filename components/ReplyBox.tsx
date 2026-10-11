"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "@/lib/client";
import { alsoHereLine } from "@/lib/overlap";
import { formatAt, sendLaterOptions, type PlanResets } from "@/lib/schedule";
import { FIXED_SHORTCUTS } from "@/lib/shortcut-catalog";
import { useNow } from "@/lib/use-now";
import type { Backend, Card, ScheduledMessage } from "@/lib/types";
import Composer, { type ComposerHandle } from "./Composer";
import Icon, { Spinner } from "./Icon";
import KeyCaps from "./KeyCaps";
import SendLater from "./SendLater";
import Tip from "./Tip";

// The key that stops a running turn from the reply box, as the shortcuts sheet lists it.
const STOP_KEY = FIXED_SHORTCUTS.find((s) => s.id === "reply-stop")?.keys[0] ?? "ctrl+c";

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
  sendLater,
  status,
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
  // Board threads can take a message to send at a set time; the copilot can't, so it leaves this out.
  // resets are the plan's next 5-hour and weekly resets, the default times on a Claude thread.
  sendLater?: { backend: Backend; resets: PlanResets; scheduled: ScheduledMessage[] };
  // The thread's statusline (context, tokens, plan limits), under the box where you scope the next message.
  status?: ReactNode;
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
  const [laterOpen, setLaterOpen] = useState(false);
  const now = useNow();
  const composer = useRef<ComposerHandle>(null);
  const draftTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // The draft not yet written. Closing the thread writes it, so Escape can close with text in the box.
  const unsaved = useRef<{ cardId: string; markdown: string } | null>(null);

  function saveDraft(markdown: string, now = false) {
    clearTimeout(draftTimer.current);
    unsaved.current = { cardId, markdown };
    const write = () => {
      if (unsaved.current) writeDraft(unsaved.current.cardId, unsaved.current.markdown);
      unsaved.current = null;
    };
    if (now) write();
    else draftTimer.current = setTimeout(write, 300);
  }

  useEffect(
    () => () => {
      clearTimeout(draftTimer.current);
      if (unsaved.current) writeDraft(unsaved.current.cardId, unsaved.current.markdown);
    },
    [],
  );

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
    // Send now with an empty box sends what's queued instead.
    if (!text && now && queue.length > 0) return sendQueuedNow();
    if (!text) {
      setError("Write a message first.");
      return;
    }
    if (live && !now) {
      setQueue((q) => [...q, text]);
      setPaused(false);
      saveDraft("", true);
      composer.current?.clear();
      return;
    }
    setSending(true);
    try {
      // Send now: interrupt the running turn first, then the message goes out as the next one.
      if (live) await onStop();
      await onSend(text);
      setPaused(false);
      saveDraft("", true);
      composer.current?.clear();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  // Stops the running turn and sends queued messages now: the one at `index`, or the whole queue.
  // Whatever stays queued holds until that send is out, then waits for the turn it starts.
  async function sendQueuedNow(index?: number) {
    if (sending) return;
    const text = index === undefined ? queue.join("\n\n") : queue[index];
    setQueue((q) => (index === undefined ? [] : q.filter((_, j) => j !== index)));
    setPaused(true);
    setSending(true);
    try {
      if (live) await onStop();
      await onSend(text);
      setPaused(false);
    } catch (err) {
      setQueue((q) => [text, ...q]);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  // Sends the message at `at` from the server, so it goes even if this thread is closed by then.
  async function scheduleAt(at: number) {
    setLaterOpen(false);
    let text: string;
    try {
      text = composer.current?.read() ?? "";
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return;
    }
    if (!text) {
      setError("Write a message first.");
      composer.current?.focus();
      return;
    }
    try {
      await api.schedule(cardId, text, at);
      saveDraft("", true);
      composer.current?.clear();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const scheduled = sendLater?.scheduled ?? [];

  return (
    <div
      className="border-t border-line p-3"
      onKeyDownCapture={(e) => {
        // Alt+Enter opens Send later with the default time focused, so a second Enter schedules it.
        if (sendLater && e.key === "Enter" && e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
          e.preventDefault();
          e.stopPropagation();
          setLaterOpen(true);
          return;
        }
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
      {(queue.length > 0 || scheduled.length > 0) && (
        <ul className="mb-2 flex flex-col gap-1">
          {scheduled.map((m) => (
            <li
              key={m.id}
              className="flex items-center gap-2 rounded-md bg-sunken px-2.5 py-1.5 text-[12.5px] text-muted"
              title={`Sends ${new Date(m.at).toLocaleString("en-US", { weekday: "long", hour: "numeric", minute: "2-digit" })}, even if this thread is closed`}
            >
              <Icon name="clock" size={11} className="shrink-0" />
              <span className="shrink-0 font-mono text-[11px]">{formatAt(m.at, now)}</span>
              <button
                type="button"
                onClick={() => {
                  // Back into an empty box to edit; it stops being scheduled until you schedule it again.
                  if (!composer.current?.isEmpty()) return setError("Clear the box first to edit a scheduled message.");
                  composer.current.write(m.text);
                  void api.unschedule(cardId, m.id).catch((err) => setError(err instanceof Error ? err.message : String(err)));
                }}
                title="Take it back to edit"
                className="min-w-0 flex-1 truncate text-left hover:text-ink"
              >
                {m.text}
              </button>
              <button
                type="button"
                onClick={() => void api.unschedule(cardId, m.id).catch((err) => setError(err instanceof Error ? err.message : String(err)))}
                aria-label="Cancel scheduled message"
                className="shrink-0 hover:text-ink"
              >
                <Icon name="x" size={12} />
              </button>
            </li>
          ))}
          {queue.map((text, i) => (
            <li
              key={i}
              className="flex items-center gap-2 rounded-md bg-sunken px-2.5 py-1.5 text-[12.5px] text-muted"
            >
              <span className="shrink-0 text-[11px] uppercase tracking-wide">{paused ? "Paused" : "Queued"}</span>
              <span className="min-w-0 flex-1 truncate">{text}</span>
              <button
                type="button"
                onClick={() => void sendQueuedNow(i)}
                disabled={sending}
                title={live ? "Stop the current turn and send this now" : "Send this now"}
                className="shrink-0 rounded px-1.5 py-0.5 text-[11.5px] text-ink hover:bg-line disabled:opacity-40"
              >
                Send now
              </button>
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
          saveDraft(markdown);
        }}
        sizeClass="min-h-[44px] max-h-[40vh]"
        actions={
          <>
            {sendLater && (
              <SendLater
                open={laterOpen}
                onOpenChange={setLaterOpen}
                options={sendLaterOptions(sendLater.backend, sendLater.resets, now)}
                now={now}
                onPick={(at) => void scheduleAt(at)}
                disabled={sending}
              />
            )}
            {live && (
              <Tip
                text={
                  <span className="flex items-center gap-1.5">
                    Stop this turn <KeyCaps spec={STOP_KEY} small />
                  </span>
                }
              >
                <button
                  type="button"
                  onClick={() => void onStop().catch((err) => setError(err instanceof Error ? err.message : String(err)))}
                  aria-label="Stop the current turn"
                  className="ml-1 flex shrink-0 items-center gap-1 rounded-md border border-line-strong px-2 py-1 text-[12px] text-ink hover:bg-sunken"
                >
                  <Icon name="stop" size={12} /> Stop
                </button>
              </Tip>
            )}
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
      {status && <div className="mt-1.5 px-1">{status}</div>}
      {error && <p className="mt-1.5 text-[12px] text-danger">{error}</p>}
    </div>
  );
}
