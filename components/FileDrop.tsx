"use client";

import { handFiles, NEW_THREAD, type DropSpot } from "@/lib/file-drop";
import { useFileDrop } from "@/lib/use-file-drop";
import type { Card } from "@/lib/types";
import Icon from "./Icon";

// Files dragged in from Finder, anywhere on the board: onto a card opens it with the files in its
// reply box, onto an open thread puts them in its reply box, and anywhere else opens New thread with
// them attached. A composer under the cursor takes the drop itself. The pill says where they'll go.
export default function FileDrop({
  cards,
  newOpen,
  onOpenCard,
  onOpenNew,
}: {
  cards: readonly Card[];
  // The New thread dialog is already open: keep its folder, just add the files.
  newOpen: boolean;
  onOpenCard: (card: Card) => void;
  onOpenNew: () => void;
}) {
  const spot = useFileDrop((at, files) => {
    if (at.kind === "card") {
      const card = cards.find((c) => c.id === at.id);
      if (!card) return;
      handFiles(card.id, files);
      onOpenCard(card);
    } else if (at.kind === "thread") {
      handFiles(at.id, files);
    } else {
      handFiles(NEW_THREAD, files);
      if (!newOpen) onOpenNew();
    }
  });
  if (!spot) return null;
  return (
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border border-accent bg-panel px-4 py-2 text-[13px] font-medium text-ink shadow-lg">
      <Icon name="paperclip" size={14} className="text-accent" />
      <span className="max-w-[360px] truncate">{hintFor(spot, cards)}</span>
    </div>
  );
}

export function hintFor(spot: DropSpot, cards: readonly Card[]) {
  if (spot.kind === "card") {
    const title = cards.find((c) => c.id === spot.id)?.title;
    return title ? `Drop to attach to “${title}”` : "Drop to attach to this thread";
  }
  if (spot.kind === "thread") return "Drop to attach to this thread";
  return "Drop to start a new thread with these files";
}
