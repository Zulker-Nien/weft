import { randomUUID } from "node:crypto";
import type { PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import { describeBoardTool } from "./board-tools";
import { editPreview } from "./edit-preview";
import { shortToolName, summarizeInput } from "./format";
import { writeQuestionPreview } from "./question-preview";
import { suggestReadScope } from "./read-scope";
import { safeUpdate, sessions, type Pending, type Session } from "./runner-state";
import { appendThread, replaceThreadItem } from "./store";
import { readQuestions } from "./turn";
import { MODE_OPTIONS, type PermissionMode, type PromptReason, type QuestionReply } from "./types";

// A thread's permission requests and questions: asked on the card, answered from the board.

// pendingId ties the answer to the request the user saw; without it, the oldest one is answered.
// reply carries a question's notes, or the message that declines it to talk it over instead.
export function answerPermission(
  cardId: string,
  allow: boolean,
  answers?: Record<string, string>,
  pendingId?: string,
  reply?: QuestionReply,
) {
  const queue = sessions.get(cardId)?.pending ?? [];
  const target = pendingId ? queue.find((p) => p.id === pendingId) : queue[0];
  if (!target) throw new Error(pendingId ? "That request isn't waiting anymore." : "Nothing is waiting for an answer.");
  if (target.questions && allow && !answers) throw new Error("This thread asked a question, so it needs answers.");
  settle(cardId, allow, answers, target.id, reply);
}

// denyMessage: what a denial tells the thread instead of "The user denied this" (a Wait that ended, lib/permission-wait.ts).
export function settle(
  cardId: string,
  allow: boolean,
  answers?: Record<string, string>,
  pendingId?: string,
  reply?: QuestionReply,
  denyMessage?: string,
) {
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
  p.resolve(denyMessage && !allow ? { behavior: "deny", message: denyMessage } : permissionResult(p, allow, answers, reply));
  return true;
}

// What the CLI gets back: the input (with the answers and any notes, for a question), or a denial, which
// for a question carries what the user wrote instead of answering.
function permissionResult(p: Pending, allow: boolean, answers?: Record<string, string>, reply?: QuestionReply): PermissionResult {
  if (p.questions) {
    if (allow && answers) {
      const annotations = reply?.annotations && Object.keys(reply.annotations).length ? { annotations: reply.annotations } : {};
      return { behavior: "allow", updatedInput: { ...p.input, answers, ...annotations } };
    }
    const chat = reply?.chat?.trim();
    return {
      behavior: "deny",
      message: chat
        ? `The user didn't pick an answer and wants to talk it over instead. They wrote: ${chat}`
        : "The user skipped the question.",
    };
  }
  return allow ? { behavior: "allow", updatedInput: p.input } : { behavior: "deny", message: "The user denied this in Weft." };
}

export function pendingView(p: Pending) {
  return { id: p.id, toolName: p.toolName, title: p.title, input: p.input, questions: p.questions, readScope: p.readScope, previewUrl: p.previewUrl, edit: p.edit, why: p.why, waiting: p.waiting };
}

export function askUser(
  cardId: string,
  session: Session,
  toolName: string,
  input: Record<string, unknown>,
  signal: AbortSignal,
  title?: string,
  // From the claim guard: the symbols the edit touches, for its preview, and why it asked.
  claim: { symbols?: string[]; why?: PromptReason } = {},
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
    // The first question that names a folder outside the project wins; more buttons would be noise.
    const readScope = questions?.map((q) => suggestReadScope(q.question, session.spec.cwd)).find((s) => s !== undefined);
    const previewUrl = questions ? questionPreview(cardId, questions) : undefined;
    const edit = questions ? undefined : editPreview(toolName, input, session.spec.cwd, claim.symbols);
    const why = questions ? undefined : (claim.why ?? modeWhy(session.spec.permissionMode, toolName));
    const p: Pending = { id, index, toolName, title: label, input, questions, readScope, previewUrl, edit, why, resolve };
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

// The options' preview page, if any option has one; a page that can't be written just leaves the previews out.
function questionPreview(cardId: string, questions: NonNullable<Pending["questions"]>) {
  try {
    return writeQuestionPreview(cardId, questions);
  } catch {
    return undefined;
  }
}

// Why a prompt with no claim behind it came up: the card's permission mode asks before this tool.
export function modeWhy(mode: PermissionMode, toolName: string): PromptReason {
  const option = MODE_OPTIONS.find((m) => m.id === mode);
  return { category: "mode", detail: `${option ? option.label : "This card"} asks before ${shortToolName(toolName)}` };
}
