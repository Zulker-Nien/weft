// Opening a card on the board from inside a thread (lib/thread-transport.ts's "Continue in new card"): one
// window event, so the thread's components don't need a handle on the board's selection. The board listens
// in lib/use-board-actions.ts; the card it names may not be in its list yet, so it selects by id.

export const OPEN_CARD_EVENT = "weft:open-card";

export function openCardById(cardId: string): void {
  window.dispatchEvent(new CustomEvent<string>(OPEN_CARD_EVENT, { detail: cardId }));
}

// Calls `handle` with each requested card id; returns the unsubscribe.
export function onOpenCardRequest(handle: (cardId: string) => void): () => void {
  const listener = (e: Event) => {
    const id = (e as CustomEvent<string | undefined>).detail;
    if (id) handle(id);
  };
  window.addEventListener(OPEN_CARD_EVENT, listener);
  return () => window.removeEventListener(OPEN_CARD_EVENT, listener);
}
