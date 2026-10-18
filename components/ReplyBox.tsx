"use client";

import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";
import { bangCommand } from "@/lib/bang";
import { type PlanResets } from "@/lib/schedule";
import { replyPlaceholder } from "@/lib/reply-placeholder";
import { useReplyDraft } from "@/lib/use-reply-draft";
import { useReplyKeys } from "@/lib/use-reply-keys";
import { useReplySchedule } from "@/lib/use-reply-schedule";
import { useReplyContinue } from "@/lib/use-reply-continue";
import { useNow } from "@/lib/use-now";
import type { Backend, ScheduledMessage } from "@/lib/types";
import Composer, { type ComposerHandle } from "./Composer";
import QuestionForm, { type QuestionFormHandle, type QuestionProps } from "./QuestionForm";
import ReplyBoxActions from "./ReplyBoxActions";
import { EditingNote, ReplyQueue } from "./ReplyQueue";

// Board threads can take a message to send at a set time; the copilot can't, so it leaves this out.
// resets are the plan's next 5-hour and weekly resets, the default times on a Claude thread.
type SendLater = { backend: Backend; resets: PlanResets; scheduled: ScheduledMessage[] };

// Your last sent message, for ↑ to edit (board threads only). canRewind: Enter replaces it and its
// turn; otherwise the edit goes out as a new message. fileEdits: what its turn changed on disk, which stays.
type EditLast = { text: string; canRewind: boolean; fileEdits: number; onEdit: (text: string) => Promise<void> };

// A thread's reply box: the same composer as a new thread (Markdown, pasted images and videos,
// dictation), sized for a reply. Enter sends; Shift+Enter starts a new line. A message starting with "!"
// is a shell command instead (onShell): it runs in the card's folder, even mid-turn, and the box turns amber.
export default function ReplyBox({
  cardId,
  cwd,
  live,
  placeholder,
  suggestion,
  sendLater,
  status,
  autoFocus,
  editLast,
  onEditing,
  question,
  onSend,
  onShell,
  onStop,
}: {
  cardId: string;
  cwd: string;
  live: boolean;
  placeholder: string;
  suggestion?: string;
  sendLater?: SendLater;
  status?: ReactNode;
  autoFocus?: boolean;
  editLast?: EditLast;
  onEditing?: (editing: boolean) => void;
  question?: QuestionProps & { key: string };
  onSend: (text: string) => Promise<void>;
  onShell?: (command: string) => Promise<void>;
  onStop: () => Promise<void>;
}) {
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
  const form = useRef<QuestionFormHandle>(null);

  // The queued messages on their way out, numbered so each batch is sent exactly once.
  const [outgoing, setOutgoing] = useState<{ id: number; text: string } | null>(null);
  const sentId = useRef(0);

  const setErrorWrap = (err: unknown) => setError(err instanceof Error ? err.message : String(err));
  const clearError = () => setError(null);
  const { initial, save: saveDraft, shell } = useReplyDraft(cardId, onShell, clearError);

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
      setErrorWrap(err);
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
      setErrorWrap(err);
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
      setErrorWrap(err);
    } finally {
      setSending(false);
    }
  }

  // Runs the "!" command in the box; it doesn't wait for a running turn.
  async function runShell() {
    const command = bangCommand(composer.current?.readText() ?? "") ?? "";
    if (!command || !onShell) {
      setError("Write a command after the !.");
      return;
    }
    setSending(true);
    try {
      await onShell(command);
      saveDraft("", true);
      composer.current?.clear();
    } catch (err) {
      setErrorWrap(err);
    } finally {
      setSending(false);
    }
  }

  async function submit(now = false) {
    if (sending) return;
    if (shell && !editing) return runShell();
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
      setErrorWrap(err);
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
      setErrorWrap(err);
    } finally {
      setSending(false);
    }
  }

  // Enter or Send: answers a waiting question (a "!" command still runs), else sends.
  function send(now = false) {
    if (question && form.current && !shell) form.current.enter();
    else void submit(now);
  }

  // Continue: the literal word "continue" through the same onSend path as a typed message.
  const { canContinue, sendContinue } = useReplyContinue({
    live,
    question: Boolean(question),
    shell,
    editing,
    onSend,
    setError: setErrorWrap,
  });

  const { scheduleAt, unschedule, takeBackScheduled } = useReplySchedule(cardId, composer, saveDraft, setErrorWrap);
  const { onKeyDownCapture, onKeyDown } = useReplyKeys({
    composer,
    form,
    question,
    live,
    suggestion,
    editing,
    editLast,
    queue,
    sendLater,
    setLaterOpen,
    cancelEdit,
    setEditing,
    setQueue,
    setPaused,
    onStop,
    setError: setErrorWrap,
  });

  const scheduled = sendLater?.scheduled ?? [];

  return (
    <div className="border-t border-line p-3" onKeyDownCapture={onKeyDownCapture} onKeyDown={onKeyDown}>
      {question && <QuestionForm {...question} key={question.key} ref={form} cardId={cardId} composer={composer} />}
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
        dropTarget={cardId}
        initial={initial}
        autoFocus={autoFocus}
        placeholder={replyPlaceholder(live, suggestion, placeholder, Boolean(question))}
        onSubmit={() => send()}
        onChange={saveDraft}
        sizeClass="min-h-[44px] max-h-[40vh]"
        className={shell ? "border-warn! focus-within:border-warn!" : ""}
        actions={
          <ReplyBoxActions
            live={live}
            question={Boolean(question)}
            sending={sending}
            shell={shell}
            sendLater={sendLater ? { backend: sendLater.backend, resets: sendLater.resets } : undefined}
            laterOpen={laterOpen}
            setLaterOpen={setLaterOpen}
            now={now}
            onPick={(at) => void scheduleAt(at)}
            onSend={(now) => send(now)}
            onStop={onStop}
            onStopError={setErrorWrap}
            onContinue={sendContinue}
            showContinue={canContinue}
          />
        }
      />
      {status && <div className="mt-1.5 px-1">{status}</div>}
      {error && <p className="mt-1.5 text-[12px] text-danger">{error}</p>}
    </div>
  );
}
