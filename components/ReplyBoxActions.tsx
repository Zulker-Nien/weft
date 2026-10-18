"use client";

// The ReplyBox's right-side actions: Stop, the primary that names what Enter does and its ▾ menu (ReplyButtons),
// and Send later's time picker, which opens from that menu or ⌥↵ (it has no button of its own any more).
// Pure JSX: the parent owns the state and passes the handlers.
import type { Backend } from "@/lib/types";
import type { ReplyAction, ReplyModeView } from "@/lib/reply-mode";
import { sendLaterOptions, type PlanResets } from "@/lib/schedule";
import SendLater from "./SendLater";
import ReplyButtons from "./ReplyButtons";

export default function ReplyBoxActions({
  view,
  live,
  sending,
  sendLater,
  laterOpen,
  setLaterOpen,
  now,
  onPick,
  onAction,
  onStop,
  onStopError,
}: {
  view: ReplyModeView;
  live: boolean;
  sending: boolean;
  sendLater?: { backend: Backend; resets: PlanResets };
  laterOpen: boolean;
  setLaterOpen: (open: boolean) => void;
  now: number;
  onPick: (at: number) => void;
  onAction: (action: ReplyAction) => void;
  onStop: () => Promise<void>;
  onStopError: (err: unknown) => void;
}) {
  return (
    <>
      {sendLater && (
        <SendLater
          bare
          open={laterOpen}
          onOpenChange={setLaterOpen}
          options={sendLaterOptions(sendLater.backend, sendLater.resets, now)}
          now={now}
          onPick={onPick}
          disabled={sending}
        />
      )}
      <ReplyButtons
        view={view}
        live={live}
        sending={sending}
        onAction={onAction}
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
      />
    </>
  );
}
