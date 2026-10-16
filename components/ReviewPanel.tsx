"use client";

import type { Card, ThreadItem } from "@/lib/types";
import { ReviewPanelNoTour } from "./ReviewPanelNoTour";
import { ReviewPanelTour } from "./ReviewPanelTour";

// The tour a thread left for its Review card: one step at a time, with what to look for, the page
// opened in the browser pane when it's a web product, and a box to send feedback on that step.
export default function ReviewPanel({
  card,
  items,
  onSend,
}: {
  card: Card;
  items: ThreadItem[];
  onSend: (text: string) => Promise<void>;
}) {
  // A new plan (the thread answered feedback) starts the tour over.
  return card.review ? (
    <ReviewPanelTour key={JSON.stringify(card.review)} cardId={card.id} cwd={card.cwd} plan={card.review} items={items} onSend={onSend} />
  ) : (
    <ReviewPanelNoTour cardId={card.id} items={items} onSend={onSend} />
  );
}