"use client";

// The ReplyBox's right-side actions: Send later (when given) and Send/Stop. Pure JSX: the parent owns
// the state and passes the handlers and the picker props.
import type { Backend } from "@/lib/types";
import { sendLaterOptions, type PlanResets } from "@/lib/schedule";
import SendLater from "./SendLater";
import ReplyButtons from "./ReplyButtons";

export default function ReplyBoxActions({
  live,
  question,
  sending,
  shell,
  sendLater,
  laterOpen,
  setLaterOpen,
  now,
  onPick,
  onSend,
  onStop,
  onStopError,
  onContinue,
  showContinue = false,
}: {
  live: boolean;
  question: boolean;
  sending: boolean;
  shell: boolean;
  sendLater?: { backend: Backend; resets: PlanResets };
  laterOpen: boolean;
  setLaterOpen: (open: boolean) => void;
  now: number;
  onPick: (at: number) => void;
  // Send now (interrupts the turn) vs Send (queues if a turn is running, else sends right away).
  onSend: (now: boolean) => void;
  onStop: () => Promise<void>;
  onStopError: (err: unknown) => void;
  // Sends the word "continue" through the same path as a typed message — matches the card-level ▶
  // (lib/resume-actions.ts via api.send(id, "continue")). ReplyBox wires this to the same `onSend(text)`
  // Send uses; ReplyButtons only shows the button while the parent opts in.
  onContinue: () => void;
  // Hidden by default: ReplyBox only opts in when the thread is idle, no question is waiting, the box
  // isn't a "!" shell command, and we're not editing the last message.
  showContinue?: boolean;
}) {
  return (
    <>
      {sendLater && (
        <SendLater
          open={laterOpen}
          onOpenChange={setLaterOpen}
          options={sendLaterOptions(sendLater.backend, sendLater.resets, now)}
          now={now}
          onPick={onPick}
          disabled={sending}
        />
      )}
      <ReplyButtons
        live={live}
        answering={question}
        sending={sending}
        shell={shell}
        onStop={() => {
          // try/catch, not .catch(): a caller whose onStop throws or returns no promise still lands in onStopError.
          void (async () => {
            try {
              await onStop();
            } catch (err) {
              onStopError(err);
            }
          })();
        }}
        onSend={onSend}
        onContinue={onContinue}
        showContinue={showContinue}
      />
    </>
  );
}
