import { sessions } from "./runner-state";
import { getCard, updateCard } from "./store";

// Stops one of a thread's subagents or background commands from the task strip. The CLI ends it and
// reports it through a task_notification ("stopped"), which lib/task-ledger.ts records. With no CLI to
// ask (it closed, or the task was left "running" by a missed event), the task is only marked stopped.
export async function stopTask(cardId: string, taskId: string): Promise<void> {
  const task = getCard(cardId)?.tasks?.find((t) => t.id === taskId);
  if (!task || task.status !== "running") return;
  const query = sessions.get(cardId)?.query;
  if (query) {
    try {
      await query.stopTask(taskId);
      return;
    } catch {
      // The CLI doesn't know it any more: fall through and mark it.
    }
  }
  const tasks = getCard(cardId)?.tasks?.map((t) => (t.id === taskId && t.status === "running" ? { ...t, status: "stopped" as const, endedAt: Date.now() } : t));
  if (tasks) updateCard(cardId, { tasks });
}
