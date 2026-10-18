import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { getCard, updateCard } from "./store";
import { applyTaskMessage, hasLiveBackground, orphanTasks, taskNote } from "./tasks";

// The card side of lib/tasks.ts: the runner feeds it the CLI's task messages, ends them with the CLI,
// asks it before closing an idle CLI, and takes the note about lost tasks into the next message.

export function recordTask(cardId: string, msg: SDKMessage): void {
  const card = getCard(cardId);
  const tasks = card && applyTaskMessage(card.tasks, msg, Date.now());
  if (tasks) updateCard(cardId, { tasks });
}

// The card's CLI process ended: its running tasks went with it.
export function loseTasks(cardId: string): void {
  const tasks = orphanTasks(getCard(cardId)?.tasks, Date.now());
  if (tasks) updateCard(cardId, { tasks });
}

// Whether closing the card's idle CLI would cut off a background subagent or command.
export function hasLiveTasks(cardId: string): boolean {
  return hasLiveBackground(getCard(cardId)?.tasks, Date.now());
}

// The note that goes ahead of the next message about tasks the thread lost, once; "" when there's none.
export function takeTaskNote(cardId: string): string {
  const taken = taskNote(getCard(cardId)?.tasks);
  if (!taken) return "";
  updateCard(cardId, { tasks: taken.tasks });
  return taken.note;
}
