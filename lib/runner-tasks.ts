import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { Session } from "./runner-state";
import { appendThread } from "./store";

type SystemMessage = Extract<SDKMessage, { type: "system" }>;

// When a background task (a Bash command or subagent run with run_in_background, or moved there later) settles,
// the CLI tells the agent with a <task-notification> message, which can start a turn of its own. The SDK never
// streams that message, only a task_notification event, so the thread writes its own row from the event;
// without it, the turn's reply answers nothing you can see. Foreground tasks get the same event, but their
// tool call's result already says how they went, so only tasks seen in the background count.
export function handleTaskEvent(id: string, session: Session, msg: SystemMessage): void {
  switch (msg.subtype) {
    case "task_started":
      if (msg.is_backgrounded) backgrounded(session).add(msg.task_id);
      break;
    case "task_updated":
      if (msg.patch.is_backgrounded) backgrounded(session).add(msg.task_id);
      break;
    case "background_tasks_changed":
      for (const task of msg.tasks) backgrounded(session).add(task.task_id);
      break;
    case "task_notification":
      // skip_transcript tasks never reach the agent, so they stay out of the thread too.
      if (!session.backgrounded?.delete(msg.task_id) || msg.skip_transcript) break;
      appendThread(id, { kind: "notification", status: msg.status, summary: msg.summary.trim() || "A background task ended", at: Date.now() });
      break;
  }
}

function backgrounded(session: Session): Set<string> {
  return (session.backgrounded ??= new Set());
}
