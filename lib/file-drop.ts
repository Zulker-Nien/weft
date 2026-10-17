// Files dragged in from Finder, handed to the composer that should take them. A drop lands on a card,
// an open thread or empty board, none of which holds a composer yet (the thread may not be open, the
// New thread dialog may not be mounted), so the files wait here under their target until the
// composer for it mounts or is already listening (components/Composer.tsx `dropTarget`).

// A card id (its reply box) or NEW_THREAD (the New thread dialog).
export const NEW_THREAD = "new";

const pending = new Map<string, File[]>();
const listeners = new Set<() => void>();

export function handFiles(target: string, files: File[]) {
  if (!files.length) return;
  pending.set(target, [...(pending.get(target) ?? []), ...files]);
  listeners.forEach((l) => l());
}

// The files waiting for target, removed so they're inserted once.
export function takeFiles(target: string): File[] {
  const files = pending.get(target) ?? [];
  pending.delete(target);
  return files;
}

export function onHandedFiles(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// A drag carrying files from outside the window (not a card being dragged between columns).
export function carriesFiles(dt: DataTransfer | null | undefined) {
  return Boolean(dt && [...dt.types].includes("Files"));
}

export type DropSpot =
  // Over a composer: it takes the drop itself, right where the cursor is.
  | { kind: "composer" }
  // Over a card on the board: it opens, files in its reply box.
  | { kind: "card"; id: string; el: Element }
  // Over an open thread (or the copilot): its reply box.
  | { kind: "thread"; id: string; el: Element }
  // Anywhere else, the New thread dialog included: a new thread with the files.
  | { kind: "new" };

// Where a drop at this element goes, read from the DOM: the composer's frame, a card's data-card-id,
// a thread panel's data-drop-target.
export function dropSpotAt(target: EventTarget | null): DropSpot {
  const el = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
  if (!el) return { kind: "new" };
  if (el.closest(".composer")) return { kind: "composer" };
  const card = el.closest("[data-card-id]");
  const cardId = card?.getAttribute("data-card-id");
  if (card && cardId) return { kind: "card", id: cardId, el: card };
  const thread = el.closest("[data-drop-target]");
  const threadId = thread?.getAttribute("data-drop-target");
  if (thread && threadId && threadId !== NEW_THREAD) return { kind: "thread", id: threadId, el: thread };
  return { kind: "new" };
}

// Same spot, so a dragover over the same card doesn't re-render the hint 60 times a second.
export function sameSpot(a: DropSpot | null, b: DropSpot | null) {
  if (!a || !b) return a === b;
  if (a.kind !== b.kind) return false;
  return !("id" in a) || a.id === (b as { id: string }).id;
}
