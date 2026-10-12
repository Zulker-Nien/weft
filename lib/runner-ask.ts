import { randomUUID } from "node:crypto";
import type { PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import { describeBoardTool } from "./board-tools";
import { shortToolName, summarizeInput } from "./format";
import { safeUpdate, sessions, type Pending, type Session } from "./runner-state";
import { appendThread, replaceThreadItem } from "./store";
import { readQuestions } from "./turn";

// A thread's permission requests and questions: asked on the card, answered from the board.

// pendingId ties the answer to the request the user saw; without it, the oldest one is answered.
export function answerPermission(cardId: string, allow: boolean, answers?: Record<string, string>, pendingId?: string) {
  const queue = sessions.get(cardId)?.pending ?? [];
  const target = pendingId ? queue.find((p) => p.id === pendingId) : queue[0];
  if (!target) throw new Error(pendingId ? "That request isn't waiting anymore." : "Nothing is waiting for an answer.");
  if (target.questions && allow && !answers) throw new Error("This thread asked a question, so it needs answers.");
  settle(cardId, allow, answers, target.id);
}

export function settle(cardId: string, allow: boolean, answers?: Record<string, string>, pendingId?: string) {
  const session = sessions.get(cardId);
  if (!session) return false;
  const at = pendingId ? session.pending.findIndex((p) => p.id === pendingId) : 0;
  const p = at >= 0 ? session.pending[at] : undefined;
  if (!p) return false;
  session.pending.splice(at, 1);
  replaceThreadItem(cardId, p.index, {
    kind: "permission",
    id: p.id,
    toolName: p.toolName,
    title: p.title,
    decision: allow ? "allow" : "deny",
    answer: answers ? Object.values(answers).join("; ") : undefined,
    at: Date.now(),
  });
  const next = session.pending[0];
  safeUpdate(cardId, {
    column: next ? "needs_you" : "running",
    pending: next ? pendingView(next) : null,
    lastLine: next ? next.title : answers ? `Answered: ${Object.values(answers).join("; ")}` : `${allow ? "Allowed" : "Denied"}: ${p.title}`,
  });
  p.resolve(permissionResult(p, allow, answers));
  return true;
}

// What the CLI gets back: the input (with the answers, for a question), or a denial.
function permissionResult(p: Pending, allow: boolean, answers?: Record<string, string>): PermissionResult {
  if (p.questions) {
    return allow && answers ? { behavior: "allow", updatedInput: { ...p.input, answers } } : { behavior: "deny", message: "The user skipped the question." };
  }
  return allow ? { behavior: "allow", updatedInput: p.input } : { behavior: "deny", message: "The user denied this in Weft." };
}

export function pendingView(p: Pending) {
  return { id: p.id, toolName: p.toolName, title: p.title, input: p.input, questions: p.questions };
}

export function askUser(
  cardId: string,
  session: Session,
  toolName: string,
  input: Record<string, unknown>,
  signal: AbortSignal,
  title?: string,
): Promise<PermissionResult> {
  return new Promise((resolve) => {
    const questions = toolName === "AskUserQuestion" ? readQuestions(input) : undefined;
    const summary = summarizeInput(input);
    const label = questions
      ? questions.map((q) => q.question).join(" ")
      : (title ??
        describeBoardTool(toolName, input) ??
        (summary ? `${shortToolName(toolName)}: ${summary}` : shortToolName(toolName)));
    const id = randomUUID();
    const index = appendThread(cardId, { kind: "permission", id, toolName, title: label, at: Date.now() });
    const p: Pending = { id, index, toolName, title: label, input, questions, resolve };
    session.pending.push(p);
    if (session.pending.length === 1) {
      safeUpdate(cardId, { column: "needs_you", pending: pendingView(p), lastLine: label });
    }
    signal.addEventListener(
      "abort",
      () => {
        const at = session.pending.indexOf(p);
        if (at === -1) return;
        session.pending.splice(at, 1);
        resolve({ behavior: "deny", message: "Cancelled." });
        // The card showed this request; show the next one, or the running turn.
        if (at === 0 && session.busy && sessions.get(cardId) === session) {
          const next = session.pending[0];
          safeUpdate(cardId, {
            column: next ? "needs_you" : "running",
            pending: next ? pendingView(next) : null,
            lastLine: next ? next.title : "Working…",
          });
        }
      },
      { once: true },
    );
  });
}
