"use client";

// The open card on weft.zip, framed the way the desktop opens one (Board.tsx: a window inset over the board): the
// desktop's own ThreadPanel on the left (its header, ThreadView and ReplyBox, fed by the cloud transport the board
// provides, useCloudTransport.ts) and the card's browser pane on the right (WebPane). What you send goes to the Mac
// that runs the card as a command; under the reply box, each one still on its way (WebReplyStatus).
import { useEffect, useMemo, type ReactNode } from "react";
import { paneFor } from "@/lib/share-types";
import type { Card, QuestionReply, ThreadItem } from "@/lib/types";
import ThreadPanel from "../ThreadPanel";
import { WebPane } from "./WebPane";

export function WebThreadPanel({
  orgId,
  card,
  seed,
  shown,
  readOnly,
  footer,
  onClose,
  onSend,
  onAnswer,
}: {
  orgId: string;
  card: Card;
  // The thread the server read for a ?card= link, so the first paint isn't empty; the view reads it again itself.
  seed: ThreadItem[];
  // What the thread view draws now (raw, blob refs and all), for the pane to follow.
  shown: ThreadItem[];
  // A teammate's card: only the Mac of the account that runs it obeys, so there's no reply box.
  readOnly: boolean;
  footer: ReactNode;
  onClose: () => void;
  onSend: (text: string) => Promise<void>;
  onAnswer: (allow: boolean, answers?: Record<string, string>, reply?: QuestionReply) => void;
}) {
  const pane = useMemo(() => paneFor(shown), [shown]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div data-backdrop className="fixed inset-0 z-30 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div role="dialog" aria-label={`Thread: ${card.title}`} className="fixed inset-2 z-40 flex overflow-hidden rounded-xl border border-line-strong bg-panel shadow-2xl sm:inset-4">
        <ThreadPanel key={card.id} card={card} items={seed} streaming="" readOnly={readOnly} footer={footer} onClose={onClose} onSend={onSend} onAnswer={onAnswer} />
        <WebPane orgId={orgId} pane={pane} thumbUrl={card.thumb && /^https?:/.test(card.thumb) ? card.thumb : undefined} />
      </div>
    </>
  );
}
