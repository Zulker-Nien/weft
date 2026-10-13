import type { PermissionResult, Query, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { messageContent } from "./attachments";
import type { BoardActions } from "./board-tools";
import { keepAliveMinutes } from "./settings";
import type { BoardStatus } from "./status";
import { getCard, updateCard } from "./store";
import type { Backend, CacheState, Card, Effort, PermissionMode, Question } from "./types";
import { globalSingleton } from "./global-singleton";
import { effortFor } from "./new-thread";

// What every part of the runner shares: a thread's CLI session, the maps that hold them, and the small
// helpers around them. lib/runner.ts is the front door; lib/runner-session.ts opens and drives sessions,
// lib/runner-turn.ts handles what the CLI sends, lib/runner-ask.ts the permission requests.

export const CLI_NAMES: Record<Backend, string> = { claude: "Claude Code", puku: "puku-cli" };

export interface Pending {
  id: string;
  index: number;
  toolName: string;
  title: string;
  input: Record<string, unknown>;
  questions?: Question[];
  resolve: (result: PermissionResult) => void;
}

// The user messages for one CLI process, fed in as the user sends them.
export class Inbox implements AsyncIterable<SDKUserMessage> {
  private queue: SDKUserMessage[] = [];
  private wake?: () => void;
  private closed = false;

  // uuid becomes the prompt's id in the session transcript, which is how ↑ finds it to rewind.
  push(text: string, uuid?: string) {
    if (this.closed) throw new Error("This thread's CLI is closing. Send your message again.");
    // Images pasted into the text go along as image blocks (see lib/attachments.ts).
    const message: SDKUserMessage = { type: "user", message: { role: "user", content: messageContent(text) }, parent_tool_use_id: null };
    this.queue.push(uuid ? { ...message, uuid: uuid as SDKUserMessage["uuid"] } : message);
    this.wake?.();
  }

  close() {
    this.closed = true;
    this.wake?.();
  }

  async *[Symbol.asyncIterator]() {
    for (;;) {
      for (let next = this.queue.shift(); next !== undefined; next = this.queue.shift()) yield next;
      if (this.closed) return;
      await new Promise<void>((resolve) => (this.wake = resolve));
      this.wake = undefined;
    }
  }
}

// What a CLI process is started with. A spare's spec has no session yet.
export interface Spec {
  cwd: string;
  backend: Backend;
  permissionMode: PermissionMode;
  model?: string;
  effort?: Effort;
  sessionId?: string;
  // Continue the session as a copy instead of writing to it.
  forkSession?: boolean;
  // Resume only up to this transcript entry, dropping the turns after it (↑ to edit, editLastMessage).
  resumeAt?: string;
  copilot: boolean;
}

export interface Session {
  build: string;
  // Null while the session is a spare waiting for a new card.
  cardId: string | null;
  spec: Spec;
  query?: Query;
  inbox: Inbox;
  abort: AbortController;
  // True from a sent message until that turn's result.
  busy: boolean;
  stopping: boolean;
  // The latest BOARD STATUS line seen in the current turn.
  status?: BoardStatus;
  // Whether the current turn opened a page in the browser pane (see lib/glance.ts).
  openedPane?: boolean;
  // Counts this session's turns, so a late update page from an earlier turn is dropped.
  turnSeq?: number;
  // Parallel tool calls can ask at once; the card shows the oldest.
  pending: Pending[];
  toolIndex: Map<string, number>;
  idle?: ReturnType<typeof setTimeout>;
  // What this CLI process's cumulative cost totals are added to (see the result handler).
  costBase?: number;
  // The prompt cache after the last main-agent request: how long it stays warm, and its size in
  // tokens, which is how full the context window is.
  cache?: CacheState;
  // The CLI's session id from its init, kept while a spare so the card that adopts it can resume.
  sessionId?: string;
  // The model its init named, kept the same way so the adopting card's header can show it.
  model?: string;
  // Set once the drive loop has finished; the CLI is gone.
  ended?: boolean;
  done: Promise<void>;
}

export const sessions = globalSingleton("__threadboardSessions", () => new Map<string, Session>());
export const spares = globalSingleton("__threadboardSpares", () => new Map<string, Session>());
// Cards waiting for a CLI login to finish, to run again afterwards.
export const loginWaiters = globalSingleton("__threadboardLoginWaiters", () => new Map<Backend, Set<string>>());
// Messages waiting to run on a card one turn at a time, such as the skills of board automations.
export const queued = globalSingleton("__weftQueued", () => new Map<string, string[]>());
// Cards moved to Done: archived once the queued Done skills have all run.
export const archiveAfter = globalSingleton("__weftArchiveAfter", () => new Set<string>());

// The turn loop runs from lib/runner.ts's sendMessage through the session and back to its turn queue, so
// the modules below runner.ts reach it through these, which runner.ts fills in as it loads.
export interface RunnerHooks {
  sendQueued: (cardId: string) => void;
  needLogin: (cardId: string, backend: Backend, message: string) => void;
  boardActions: BoardActions;
}
// Every session starts through lib/runner.ts, which sets these as it loads, so none is called before then.
export const hooks = {} as RunnerHooks;

// setTimeout fires at once for anything longer than this.
const MAX_TIMER_MS = 2 ** 31 - 1;

export function close(session: Session) {
  session.inbox.close();
  session.abort.abort();
}

export function isBusy(cardId: string) {
  return sessions.get(cardId)?.busy ?? false;
}

// The card may be deleted while its thread is still running.
export function safeUpdate(id: string, patch: Partial<Card>) {
  if (getCard(id)) updateCard(id, patch);
}

export function errorText(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

// The card's stored effort may be one the backend can't take (e.g. xhigh on puku), so we normalize
// through effortFor at the point we build the spec the CLI actually runs with. A card left over
// from before switchBackend's xhigh guard is caught here on the next turn.
export function specFor(card: Card): Spec {
  return {
    cwd: card.cwd,
    backend: card.backend,
    permissionMode: card.permissionMode,
    model: card.model,
    effort: effortFor(card.backend, card.effort),
    sessionId: card.sessionId,
    copilot: card.role === "copilot",
  };
}

// Closes a card's CLI after the keep-alive time without messages (never, if that's 0).
export function scheduleIdle(session: Session) {
  clearTimeout(session.idle);
  const cardId = session.cardId;
  const settingMinutes = keepAliveMinutes();
  // A picked-up session's CLI closes after 10 idle minutes at most, for the same reason.
  const imported = getCard(cardId ?? "")?.source === "claude-code";
  const minutes = imported ? Math.min(settingMinutes || 10, 10) : settingMinutes;
  if (!cardId || minutes <= 0) return;
  session.idle = setTimeout(() => closeWhenIdle(cardId, session), Math.min(minutes * 60_000, MAX_TIMER_MS));
}

function closeWhenIdle(cardId: string, session: Session) {
  if (sessions.get(cardId) !== session || session.busy) return;
  sessions.delete(cardId);
  session.inbox.close();
  // If the CLI doesn't exit on its own once its input ends, end it.
  setTimeout(() => session.abort.abort(), 10_000);
}
