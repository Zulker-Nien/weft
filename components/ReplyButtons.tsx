"use client";

import { FIXED_SHORTCUTS } from "@/lib/shortcut-catalog";
import Icon, { Spinner } from "./Icon";
import KeyCaps from "./KeyCaps";
import Tip from "./Tip";

// The key that stops a running turn from the reply box, as the shortcuts sheet lists it.
const STOP_KEY = FIXED_SHORTCUTS.find((s) => s.id === "reply-stop")?.keys[0] ?? "ctrl+c";

function sendTip(shell: boolean, live: boolean, answering: boolean) {
  if (answering && !shell) return "Answer the question (Enter)";
  if (shell) return "Run in this folder's shell; the output goes to Claude with your next message (Enter)";
  return live ? "Queue until the turn finishes (Enter)" : "Send (Enter)";
}

// The reply box's buttons: Stop and Send now while a turn runs, then Send, which turns into Run (a
// terminal, in amber) while the box holds a "!" shell command. While the agent asks a question, Send answers it.
export default function ReplyButtons({
  live,
  answering = false,
  sending,
  shell,
  onStop,
  onSend,
}: {
  live: boolean;
  answering?: boolean;
  sending: boolean;
  shell: boolean;
  onStop: () => void;
  onSend: (now: boolean) => void;
}) {
  return (
    <>
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
            onClick={onStop}
            aria-label="Stop the current turn"
            className="ml-1 flex shrink-0 items-center gap-1 rounded-md border border-line-strong px-2 py-1 text-[12px] text-ink hover:bg-sunken"
          >
            <Icon name="stop" size={12} /> Stop
          </button>
        </Tip>
      )}
      {live && !shell && !answering && (
        <Tip text="Stop the current turn and send this now" className="inline-flex">
          <button
            type="button"
            onClick={() => onSend(true)}
            disabled={sending}
            className="ml-1 shrink-0 rounded-md border border-line-strong px-2 py-1 text-[12px] text-ink hover:bg-sunken disabled:opacity-40"
          >
            Send now
          </button>
        </Tip>
      )}
      <Tip text={sendTip(shell, live, answering)} className="inline-flex">
        <button
          type="button"
          onClick={() => onSend(false)}
          disabled={sending}
          aria-label={shell ? "Run in the shell" : answering ? "Answer" : "Send"}
          className={`ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md hover:opacity-90 disabled:opacity-40 ${
            shell ? "bg-warn-soft text-warn ring-1 ring-warn" : "bg-accent text-on-accent"
          }`}
        >
          {sending ? <Spinner size={13} /> : <Icon name={shell ? "terminal" : "send"} size={15} />}
        </button>
      </Tip>
    </>
  );
}
