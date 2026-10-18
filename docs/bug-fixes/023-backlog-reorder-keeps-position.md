# 023: Backlog drag reordering keeps the chosen position

**Date:** 2026-10-18 · **Severity:** Medium (dropping after a middle card moved the dragged card to the end, and subsequent drags could land in the wrong slot)

## Symptom

Dragging a Backlog card below a card that was not last appended it to the end of the column. Later reorder operations could also compute a slot that did not match the currently saved order.

## Cause

The drop handler represented “after this card” as `beforeId: null`, which the store interprets as append. The store also selected sibling neighbors from `createdAt` instead of following the order the user had already saved, so repeated drags could target the wrong slot.

## Fix

The client now anchors a bottom-half drop before the next sibling, using `null` only when that sibling does not exist. `lib/card-order.ts` supplies the shared comparator and slot calculation, so both optimistic updates and `reorderCard` follow saved `order`, with `createdAt` as a stable tie-breaker. If the integer gap closes, the helper renumbers every sibling in that current order; the store saves the changes and publishes a card event for each changed sibling so clients receive the full new order.

Before, a drop after a middle sibling could pass the append anchor:

```ts
// Old behavior: after the target, no anchor was sent, which meant append.
api.reorder(id, before ? target : null);
```

After, it passes the following sibling as the before-anchor:

```ts
const slot = before ? targetIndex : targetIndex + 1;
const orderChanges = ordersForSlot(siblings, id, slot);
api.reorder(id, siblings[slot]?.id ?? null);
```

Before, store neighbors were selected by creation time:

```ts
siblings.sort((a, b) => a.createdAt - b.createdAt);
```

After, slot calculation and gap recovery use current saved order:

```ts
.sort(compareCardOrder);
const orderChanges = ordersForSlot(siblings, id, beforeIndex);
for (const [changedId, order] of orderChanges) {
  const changedCard = state().cards.get(changedId);
  if (changedCard) changedCard.order = order;
}
for (const changedId of orderChanges.keys()) {
  const changedCard = state().cards.get(changedId);
  if (changedCard) publish({ type: "card", card: changedCard });
}
```

**Key rule:** Express an after-drop as “before the next sibling,” and calculate every reorder slot from the current saved order.

**Files:** `lib/card-order.ts` (+ test), `lib/use-board-card-actions.ts` (+ test), `lib/store.ts` (+ tests), `app/api/cards/[id]/route.ts`.
