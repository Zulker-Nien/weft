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
        onStop={() => void onStop().catch(onStopError)}
        onSend={onSend}
      />
    </>
  );
}
