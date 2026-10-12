# 008: a card waiting on you couldn't be moved

**Date:** 2026-10-13 | **Severity:** Low

## Symptom

A card sitting in "Needs you" with a permission prompt (Allow/Deny) or a question (Answer) was
not draggable. You couldn't triage a permission prompt out of the column without answering it,
and you couldn't file a question to look at later.

## Root Cause

Two related guards, both in `components/CardView.tsx`:

1. `const fixed = live || copilot;` made a card "fixed" whenever its session was live. A card
   waiting on you is live (`isLive(card)`) — it has an open CLI waiting for the user's reply — so
   the card couldn't be dragged. Running cards genuinely shouldn't move (the agent is mid-turn),
   but a card sitting on a question or a permission prompt is just idle from the user's point of
   view: the CLI is waiting for the answer, not the answer for the CLI.
2. The Allow/Deny row was gated on `column === "needs_you"`, so even if you did find a way to
   move the card to Backlog or Review, the buttons disappeared and the question was stranded.

## The Fix

```tsx
// before
const fixed = live || copilot;
// …
{column === "needs_you" && card.pending && !card.pending.questions && (
  <div className="mt-2 flex gap-1.5">
    <button>Allow</button>
    <button>Deny</button>
  </div>
)}

// after
const fixed = card.column === "running" || copilot;
// …
{card.pending && !card.pending.questions && (
  <div className="mt-2 flex gap-1.5">
    <button>Allow</button>
    <button>Deny</button>
  </div>
)}
```

On the server, `PATCH /api/cards/:id` previously rejected any move of a busy card. The
gate is now in a small extracted `moveCard(card, column)` helper that lets a card be parked
when it's waiting on you:

```ts
// app/api/cards/[id]/route.ts
function moveCard(card: Card, column: Column) {
  if (card.role === "copilot") throw new Error("The copilot isn't on the board.");
  // A turn waiting on you can be parked in Backlog, Review or Done; answering it later runs it on.
  const waiting = Boolean(card.pending) && MANUAL.includes(column);
  if (isBusy(card.id) && !waiting) throw new Error("Stop the thread before moving it.");
  // …
}
```

The copilot card still can't be moved: `role === "copilot"` is checked before `waiting`, and the
client side keeps `copilot` in `fixed`.

## Key Rule

A card is "fixed" when its CLI is actually doing work (`column === "running"`) or when it's
the copilot. A card waiting on the user is not running; it should be draggable, and the
question/permission UI follows it wherever it parks.

## Files Involved

`components/CardView.tsx`, `components/CardView.test.tsx`, `app/api/cards/[id]/route.ts`,
`app/api/routes.test.ts`
