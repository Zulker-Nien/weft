import { isSubmitTab, numberKey, type AnswerState } from "./question-answers";
import type { Question } from "./types";

// What a key pressed in an empty reply box does to the question above it, the way Claude Code's
// question picker reads keys: ←/→ change question, ↑/↓ move the highlight, space ticks a multi-select
// option, a number picks one. Undefined leaves the key to the box.
export type KeyAction = { tab: number } | { move: number } | { tick: true } | { pick: number };

interface Key {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

const TAB_KEYS: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1 };
const MOVE_KEYS: Record<string, number> = { ArrowUp: -1, ArrowDown: 1 };

export function keyAction(e: Key, state: AnswerState, questions: Question[]): KeyAction | undefined {
  if (e.metaKey || e.ctrlKey || e.altKey) return undefined;
  const tab = TAB_KEYS[e.key];
  if (tab !== undefined) return questions.length > 1 ? { tab: state.tab + tab } : undefined;
  const q = isSubmitTab(questions, state.tab) ? undefined : questions[state.tab];
  if (!q) return undefined;
  const move = MOVE_KEYS[e.key];
  if (move !== undefined) return { move };
  if (e.key === " ") return q.multiSelect ? { tick: true } : undefined;
  const option = e.shiftKey ? undefined : numberKey(e.key, q.options.length);
  return option === undefined ? undefined : { pick: option };
}
