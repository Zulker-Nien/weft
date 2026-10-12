"use client";

import { useEffect, useEffectEvent, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { api } from "@/lib/client";
import { readDraft, replyDraftKey, writeDraft } from "@/lib/drafts";
import { alsoHereLine } from "@/lib/overlap";
import { sendLaterOptions, type PlanResets } from "@/lib/schedule";
import { FIXED_SHORTCUTS } from "@/lib/shortcut-catalog";
import { useNow } from "@/lib/use-now";
import type { Backend, Card, ScheduledMessage } from "@/lib/types";
import Composer, { type ComposerHandle } from "./Composer";
import Icon, { Spinner } from "./Icon";
import KeyCaps from "./KeyCaps";
import { EditingNote, ReplyQueue } from "./ReplyQueue";
import SendLater from "./SendLater";
import Tip from "./Tip";

// The key that stops a running turn from the reply box, as the shortcuts sheet lists it.
const STOP_KEY = FIXED_SHORTCUTS.find((s) => s.id === "reply-stop")?.keys[0] ?? "ctrl+c";

// While a turn runs, the box says the next message waits; idle, it shows the thread's suggested next message.
function replyPlaceholder(live: boolean, suggestion: string | undefined, fallback: string) {
  if (live) return "Working. Write the next message and it'll send when this turn is done.";
  return suggestion ? `${suggestion}  ⇥ Tab` : fallback;
}

// A thread's reply box: the same composer as a new thread (Markdown, pasted images and videos,
// dictation), sized for a reply. Enter sends; Shift+Enter starts a new line.
export default function ReplyBox({
  cardId,
  cwd,
  live,
  placeholder,
  suggestion,
  alsoHere = [],
  sendLater,
  status,
  autoFocus,
  editLast,
  onEditing,
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
  // The thread's guess at your next message: shown as the placeholder, and Tab in an empty box fills it in (not sends).
  suggestion?: string;
  // Board threads can take a message to send at a set time; the copilot can't, so it leaves this out.
  // resets are the plan's next 5-hour and weekly resets, the default times on a Claude thread.
  sendLater?: {
    backend: Backend;
    resets: PlanResets;
    scheduled: ScheduledMessage[];
  };
  // The thread's statusline (context, tokens, plan limits), under the box where you scope the next message.
  status?: ReactNode;
  // Focused as it opens: the card was just started, so the keyboard stays in the board (Escape closes it).
  autoFocus?: boolean;
  // Your last sent message, for ↑ to edit (board threads only). canRewind: Enter replaces it and its turn;
  // otherwise the edit goes out as a new message. fileEdits: what its turn changed on disk, which stays.
  editLast?: { text: string; canRewind: boolean; fileEdits: number; onEdit: (text: string) => Promise<void> };
  // Tells the thread when an edit starts or ends, so it can mark the message and the reply it replaces.
  onEditing?: (editing: boolean) => void;
  onSend: (text: string) => Promise<void>;
  onStop: () => Promise<void>;
}) {
  const [initial] = useState(() => readDraft(replyDraftKey(cardId)));
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Messages written while the thread was working; they go out together once the turn ends.
  const [queue, setQueue] = useState<string[]>([]);
  // Held while you edit a message pulled back out of the queue (or after a queued send failed).
  const [paused, setPaused] = useState(false);
  const [laterOpen, setLaterOpen] = useState(false);
  // ↑ pulled your last sent message back into the box; Enter replaces it, Escape lets it be.
  const [editing, setEditingState] = useState(false);
  const now = useNow();
  const composer = useRef<ComposerHandle>(null);
  const draftTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // The queued messages on their way out, numbered so each batch is sent exactly once.
  const [outgoing, setOutgoing] = useState<{ id: number; text: string } | null>(null);
  const sentId = useRef(0);

  // The draft not yet written. Closing the thread writes it, so Escape can close with text in the box.
  const unsaved = useRef<{ cardId: string; markdown: string } | null>(null);

  // Also clears a shown error: you are typing again, or the message just went out.
  function saveDraft(markdown: string, now = false) {
    setError(null);
    clearTimeout(draftTimer.current);
    unsaved.current = { cardId, markdown };
    const write = () => {
      if (unsaved.current) writeDraft(replyDraftKey(unsaved.current.cardId), unsaved.current.markdown);
      unsaved.current = null;
    };
    if (now) write();
    else draftTimer.current = setTimeout(write, 300);
  }

  useEffect(
    () => () => {
      clearTimeout(draftTimer.current);
      if (unsaved.current) writeDraft(replyDraftKey(unsaved.current.cardId), unsaved.current.markdown);
    },
    [],
  );

  // The turn ended and nothing is being edited: what was queued leaves the queue as one message.
  // Moved during render, in the same pass that sees the turn end, so it can't be picked up twice.
  if (!live && !paused && queue.length > 0) {
    const text = queue.join("\n\n");
    setQueue([]);
    setOutgoing((o) => ({ id: (o?.id ?? 0) + 1, text }));
  }

  const sendOutgoing = useEffectEvent((text: string) => {
    onSend(text).catch((err: unknown) => {
      setQueue((q) => [text, ...q]);
      setPaused(true);
      setError(err instanceof Error ? err.message : String(err));
    });
  });

  useEffect(() => {
    if (!outgoing || sentId.current >= outgoing.id) return;
    sentId.current = outgoing.id;
    sendOutgoing(outgoing.text);
  }, [outgoing]);

  // What's in the box, or null once it has shown why the box can't be read.
  function readBox() {
    try {
      return composer.current?.read() ?? "";
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    }
  }

  function setEditing(on: boolean) {
    setEditingState(on);
    onEditing?.(on);
  }

  function cancelEdit() {
    composer.current?.clear();
    saveDraft("", true);
    setEditing(false);
  }

  // Enter on a message ↑ pulled back: it replaces the one you sent. An emptied box just cancels.
  async function sendEdit(text: string) {
    if (!text || !editLast) {
      cancelEdit();
      return;
    }
    setSending(true);
    try {
      await editLast.onEdit(text);
      cancelEdit();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  // A scheduled message back into an empty box to edit; it stops being scheduled until you schedule it again.
  function takeBackScheduled(m: ScheduledMessage) {
    if (!composer.current?.isEmpty()) {
      setError("Clear the box first to edit a scheduled message.");
      return;
    }
    composer.current.write(m.text);
    unschedule(m.id);
  }

  function unschedule(messageId: string) {
    api.unschedule(cardId, messageId).catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }

  async function submit(now = false) {
    if (sending) return;
    const text = readBox();
    if (text === null) return;
    if (editing) return sendEdit(text);
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
    if (text === undefined) return;
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
    const text = readBox();
    if (text === null) return;
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

  // Tab in an empty box takes the suggested next message, to edit or send.
  function takeSuggestion(e: KeyboardEvent) {
    const plainTab = e.key === "Tab" && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey;
    if (!plainTab || !suggestion || live || !composer.current?.isEmpty()) return false;
    e.preventDefault();
    e.stopPropagation();
    composer.current.write(suggestion);
    return true;
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
        if (takeSuggestion(e)) return;
        // Escape drops an edit and leaves the message as it was sent (before it would close the thread).
        if (editing && e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          cancelEdit();
          return;
        }
        if (e.key !== "ArrowUp" || !composer.current?.isEmpty()) return;
        // Up in an empty box pulls the last queued message back to edit; the queue holds meanwhile.
        const last = queue.at(-1);
        if (last !== undefined) {
          e.preventDefault();
          e.stopPropagation();
          composer.current.write(last);
          setQueue((q) => q.slice(0, -1));
          setPaused(true);
        } else if (editLast && !editing) {
          // With nothing queued, it pulls back the last message you sent.
          e.preventDefault();
          e.stopPropagation();
          composer.current.write(editLast.text);
          setEditing(true);
        }
      }}
      onKeyDown={(e) => {
        // Ctrl+C stops the running turn, unless text is selected (then it's a copy).
        if (live && e.ctrlKey && !e.metaKey && e.key.toLowerCase() === "c" && !window.getSelection()?.toString()) {
          e.preventDefault();
          void onStop().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
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
      <ReplyQueue
        scheduled={scheduled}
        queue={queue}
        paused={paused}
        live={live}
        sending={sending}
        now={now}
        onTakeBack={takeBackScheduled}
        onUnschedule={unschedule}
        onSendNow={(i) => void sendQueuedNow(i)}
        onRemove={(i) => setQueue((q) => q.filter((_, j) => j !== i))}
      />
      {editing && editLast && <EditingNote {...editLast} live={live} />}
      <Composer
        ref={composer}
        variant="reply"
        cwd={cwd}
        initial={initial}
        autoFocus={autoFocus}
        placeholder={replyPlaceholder(live, suggestion, placeholder)}
        onSubmit={() => void submit()}
        onChange={saveDraft}
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
                  onClick={() =>
                    void onStop().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
                  }
                  aria-label="Stop the current turn"
                  className="ml-1 flex shrink-0 items-center gap-1 rounded-md border border-line-strong px-2 py-1 text-[12px] text-ink hover:bg-sunken"
                >
                  <Icon name="stop" size={12} /> Stop
                </button>
              </Tip>
            )}
            {live && (
              <Tip text="Stop the current turn and send this now" className="inline-flex">
                <button
                  type="button"
                  onClick={() => void submit(true)}
                  disabled={sending}
                  className="ml-1 shrink-0 rounded-md border border-line-strong px-2 py-1 text-[12px] text-ink hover:bg-sunken disabled:opacity-40"
                >
                  Send now
                </button>
              </Tip>
            )}
            <Tip text={live ? "Queue until the turn finishes (Enter)" : "Send (Enter)"} className="inline-flex">
              <button
                type="button"
                onClick={() => void submit()}
                disabled={sending}
                aria-label="Send"
                className="ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent text-on-accent hover:opacity-90 disabled:opacity-40"
              >
                {sending ? <Spinner size={13} /> : <Icon name="send" size={15} />}
              </button>
            </Tip>
          </>
        }
      />
      {status && <div className="mt-1.5 px-1">{status}</div>}
      {error && <p className="mt-1.5 text-[12px] text-danger">{error}</p>}
    </div>
  );
}
