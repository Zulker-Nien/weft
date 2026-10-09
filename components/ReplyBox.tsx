"use client";

import { useEffect, useRef, useState } from "react";
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
  onSend,
}: {
  cardId: string;
  cwd: string;
  // A turn is running or waiting on a permission answer, so a reply can't go yet.
  live: boolean;
  placeholder: string;
  onSend: (text: string) => Promise<void>;
}) {
  const [initial] = useState(() => readDraft(cardId));
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const composer = useRef<ComposerHandle>(null);
  const draftTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(draftTimer.current), []);

  async function submit() {
    if (sending) return;
    if (live) {
      setError("This thread is still working. Send this when it's done, or stop it first.");
      return;
    }
    let text: string;
    try {
      text = composer.current?.read() ?? "";
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return;
    }
    if (!text) {
      setError("Write a message first.");
      return;
    }
    setSending(true);
    try {
      await onSend(text);
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
    <div className="border-t border-line p-3">
      <Composer
        ref={composer}
        variant="reply"
        cwd={cwd}
        initial={initial}
        placeholder={live ? "Working. Stop it to reply, or write the next message for when it's done." : placeholder}
        onSubmit={() => void submit()}
        onChange={(markdown) => {
          setError(null);
          clearTimeout(draftTimer.current);
          draftTimer.current = setTimeout(() => writeDraft(cardId, markdown), 300);
        }}
        sizeClass="min-h-[44px] max-h-[40vh]"
        actions={
          <button
            type="button"
            onClick={() => void submit()}
            disabled={live || sending}
            aria-label="Send"
            title={live ? "Wait for the turn to finish, or stop it" : "Send (Enter)"}
            className="ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent text-on-accent hover:opacity-90 disabled:opacity-40"
          >
            {sending ? <Spinner size={13} /> : <Icon name="send" size={15} />}
          </button>
        }
      />
      {error && <p className="mt-1.5 text-[12px] text-danger">{error}</p>}
    </div>
  );
}
