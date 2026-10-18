"use client";

// The ReplyBox's draft: a debounced write of the prompt to localStorage, with a final flush when
// the box unmounts. The thread that owns the box reads `weft.reply.<cardId>` on its way in.
import { useEffect, useRef, useState } from "react";
import { readDraft, replyDraftKey, writeDraft } from "@/lib/drafts";
import { isBang } from "@/lib/bang";

// What the caller learns: the initial text (and which calls are shell commands), a debounced
// writer, and an immediate writer for "the message just went out" and unmount flushes.
export interface UseReplyDraft {
  initial: string;
  save: (markdown: string, now?: boolean) => void;
  // True while the box currently starts with "!"; with onShell, Enter runs the command.
  shell: boolean;
  setShell: (next: boolean) => void;
  // True while the box holds nothing but whitespace (lib/reply-mode.ts: Continue only offers itself then).
  empty: boolean;
}

export function useReplyDraft(cardId: string, onShell: unknown, clearError: () => void): UseReplyDraft {
  const [initial] = useState(() => readDraft(replyDraftKey(cardId)));
  const [shell, setShell] = useState(() => Boolean(onShell) && isBang(initial));
  const [empty, setEmpty] = useState(() => !initial.trim());
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // The draft not yet written. Closing the thread writes it, so Escape can close with text in the box.
  const unsaved = useRef<{ cardId: string; markdown: string } | null>(null);

  function save(markdown: string, now = false) {
    clearError();
    setShell(Boolean(onShell) && isBang(markdown));
    setEmpty(!markdown.trim());
    clearTimeout(timer.current);
    unsaved.current = { cardId, markdown };
    const write = () => {
      if (unsaved.current) writeDraft(replyDraftKey(unsaved.current.cardId), unsaved.current.markdown);
      unsaved.current = null;
    };
    if (now) write();
    else timer.current = setTimeout(write, 300);
  }

  useEffect(
    () => () => {
      clearTimeout(timer.current);
      if (unsaved.current) writeDraft(replyDraftKey(unsaved.current.cardId), unsaved.current.markdown);
    },
    [],
  );

  return { initial, save, shell, setShell, empty };
}
