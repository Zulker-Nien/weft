"use client";

import { useShortcuts } from "./hotkeys";

// Continue: the literal word "continue" sent through the same `onSend` path as a typed message —
// matches the card-level ▶ (lib/resume-actions.ts, via api.send(id, "continue")). Hidden whenever
// Send would itself be reading the box, so the two can't race: a turn running (Send queues), a
// question waiting (Send answers), a "!" shell command (Send runs it), or ↑ editing the last
// message (Send replaces it).
export function useReplyContinue({
  live,
  question,
  shell,
  editing,
  onSend,
  setError,
}: {
  live: boolean;
  question: boolean;
  shell: boolean;
  editing: boolean;
  onSend: (text: string) => Promise<void>;
  setError: (err: unknown) => void;
}) {
  // A regular function, not useEffectEvent, because it's only ever called from event handlers
  // (the Continue button click and the ⌘. shortcut) — never from a useEffect that would need a
  // stable identity. Guarded again here in case the shortcut is fired after canContinue flips.
  const canContinue = !live && !question && !shell && !editing;
  function sendContinue() {
    if (!canContinue) return;
    onSend("continue").catch(setError);
  }

  useShortcuts([
    {
      id: "reply-continue",
      keys: ["mod+."],
      description: "Send “continue” so the thread keeps going",
      group: "Thread",
      allowInInput: true,
      enabled: canContinue,
      handler: () => sendContinue(),
    },
  ]);

  return { canContinue, sendContinue };
}
