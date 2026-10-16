"use client";

// The ReplyBox's scheduled-message side: server schedule/unschedule and the "take it back to edit"
// handoff. The composer ref and the draft saver are passed in so the box is the only state owner.
import { useCallback, type RefObject } from "react";
import { api } from "@/lib/client";
import type { ComposerHandle } from "@/components/Composer";
import type { ScheduledMessage } from "@/lib/types";

export interface UseReplySchedule {
  // The "Send later" picker picked a time: hand the message to the server.
  scheduleAt: (at: number) => Promise<void>;
  // The user clicked the X on a queued scheduled message: drop it on the server.
  unschedule: (messageId: string) => void;
  // The user clicked a scheduled message to edit it: put it in the empty box and stop scheduling it.
  takeBackScheduled: (m: ScheduledMessage) => void;
}

export function useReplySchedule(
  cardId: string,
  composer: RefObject<ComposerHandle | null>,
  saveDraft: (markdown: string, now?: boolean) => void,
  setError: (err: unknown) => void,
): UseReplySchedule {
  const unschedule = useCallback(
    (messageId: string) => {
      api.unschedule(cardId, messageId).catch((err: unknown) => setError(err));
    },
    [cardId, setError],
  );

  const takeBackScheduled = useCallback(
    (m: ScheduledMessage) => {
      if (!composer.current?.isEmpty()) {
        setError("Clear the box first to edit a scheduled message.");
        return;
      }
      composer.current.write(m.text);
      api.unschedule(cardId, m.id).catch((err: unknown) => setError(err));
    },
    [cardId, composer, setError],
  );

  const scheduleAt = useCallback(
    async (at: number) => {
      let text: string;
      try {
        text = composer.current?.read() ?? "";
      } catch (err) {
        setError(err);
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
        setError(err);
      }
    },
    [cardId, composer, saveDraft, setError],
  );

  return { scheduleAt, unschedule, takeBackScheduled };
}
