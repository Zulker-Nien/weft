import type { Card } from "./types";

export type OrderedCard = Pick<Card, "id" | "order" | "createdAt">;

export const ORDER_STEP = 1024;

export function compareCardOrder(a: OrderedCard, b: OrderedCard) {
  return (a.order ?? a.createdAt) - (b.order ?? b.createdAt) || a.createdAt - b.createdAt;
}

// Return only the moved card's order when there is room, or all sibling orders when the
// integer gap has closed and the column needs evenly spaced positions again.
export function ordersForSlot(siblings: readonly OrderedCard[], movedId: string, slot: number) {
  const previous = siblings[slot - 1];
  const next = siblings[slot];
  const previousOrder = previous ? previous.order ?? previous.createdAt : undefined;
  const nextOrder = next ? next.order ?? next.createdAt : undefined;

  if (previousOrder === undefined) {
    return new Map([[movedId, nextOrder === undefined ? ORDER_STEP : nextOrder - ORDER_STEP]]);
  }
  if (nextOrder === undefined) return new Map([[movedId, previousOrder + ORDER_STEP]]);

  const gap = nextOrder - previousOrder;
  if (gap >= 2) return new Map([[movedId, previousOrder + Math.floor(gap / 2)]]);

  const ordered = [...siblings];
  ordered.splice(slot, 0, { id: movedId, createdAt: 0 });
  return new Map(ordered.map((card, index) => [card.id, (index + 1) * ORDER_STEP]));
}
