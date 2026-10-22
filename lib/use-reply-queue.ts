"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";

export interface ReplyQueueOptions {
  live: boolean;
  // Another send from the box is in flight, so Send now waits its turn.
  busy: boolean;
  onSend: (text: string) => Promise<void>;
  onStop: () => Promise<void>;
  // A queued batch went out (ReplyBox counts the reply).
  onSent: () => void;
  onError: (err: unknown) => void;
}

// Replies written while the thread was working (components/ReplyBox.tsx). They go out together, exactly once, as the
// turn ends; a failed send puts them back at the front, on hold. Paused holds the queue while you edit a message
// pulled back out of it (lib/use-reply-keys.ts) or after a failed send, until Enter.
export function useReplyQueue({ live, busy, onSend, onStop, onSent, onError }: ReplyQueueOptions) {
  const [queue, setQueue] = useState<string[]>([]);
  const [paused, setPaused] = useState(false);
  const [sending, setSending] = useState(false);
  // The queued messages on their way out, numbered so each batch is sent exactly once.
  const [outgoing, setOutgoing] = useState<{ id: number; text: string } | null>(null);
  const sentId = useRef(0);

  // The turn ended and nothing is being edited: what was queued leaves the queue as one message.
  // Moved during render, in the same pass that sees the turn end, so it can't be picked up twice.
  if (!live && !paused && queue.length > 0) {
    const text = queue.join("\n\n");
    setQueue([]);
    setOutgoing((o) => ({ id: (o?.id ?? 0) + 1, text }));
  }

  const sendOutgoing = useEffectEvent((text: string) => {
    onSend(text).then(onSent).catch((err: unknown) => {
      setQueue((q) => [text, ...q]);
      setPaused(true);
      onError(err);
    });
  });

  useEffect(() => {
    if (!outgoing || sentId.current >= outgoing.id) return;
    sentId.current = outgoing.id;
    sendOutgoing(outgoing.text);
  }, [outgoing]);

  // Stops the running turn and sends queued messages now: the one at `index`, or the whole queue.
  // Whatever stays queued holds until that send is out, then waits for the turn it starts.
  async function sendNow(index?: number) {
    if (busy || sending) return;
    const text = index === undefined ? queue.join("\n\n") : queue[index];
    if (text === undefined) return;
    setQueue((q) => (index === undefined ? [] : q.filter((_, j) => j !== index)));
    setPaused(true);
    setSending(true);
    try {
      if (live) await onStop();
      await onSend(text);
      onSent();
      setPaused(false);
    } catch (err) {
      setQueue((q) => [text, ...q]);
      onError(err);
    } finally {
      setSending(false);
    }
  }

  return {
    queue,
    paused,
    sending,
    setQueue,
    setPaused,
    sendNow,
    // Queue a reply behind the running turn; it lets a held queue go again.
    add: (text: string) => {
      setQueue((q) => [...q, text]);
      setPaused(false);
    },
    resume: () => setPaused(false),
    remove: (index: number) => setQueue((q) => q.filter((_, j) => j !== index)),
  };
}
