import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { query, type PermissionResult, type Query, type SDKMessage, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { messageContent } from "./attachments";
import { COPILOT_PROMPT, SAFE_BOARD_TOOLS, boardMcpServer, describeBoardTool } from "./board-tools";
import { BROWSER_PROMPT, browserMcpServer } from "./browser-tools";
import { publish } from "./bus";
import { shortToolName } from "./format";
import { cliEnv } from "./env";
import { isOpenElsewhere } from "./import";
import { isNotLoggedInError, startLogin } from "./login";
import { keepAliveMinutes, threadPrompt } from "./settings";
import { extractStatus, type BoardStatus } from "./status";
import { appendThread, getCard, getThread, replaceThreadItem, updateCard } from "./store";
import type { Backend, Card, PermissionMode, Question } from "./types";

// Spare CLIs started ahead of time, one per recent project folder, so a new card doesn't wait.
const MAX_SPARES = 3;

const CLI_NAMES: Record<Backend, string> = { claude: "Claude Code", puku: "puku-cli" };

interface Pending {
  id: string;
  index: number;
  toolName: string;
  title: string;
  input: Record<string, unknown>;
  questions?: Question[];
  resolve: (result: PermissionResult) => void;
}

// The user messages for one CLI process, fed in as the user sends them.
class Inbox implements AsyncIterable<SDKUserMessage> {
  private queue: SDKUserMessage[] = [];
  private wake?: () => void;
  private closed = false;

  push(text: string) {
    if (this.closed) throw new Error("This thread's CLI is closing. Send your message again.");
    // Images pasted into the text go along as image blocks (see lib/attachments.ts).
    this.queue.push({ type: "user", message: { role: "user", content: messageContent(text) }, parent_tool_use_id: null });
    this.wake?.();
  }

  close() {
    this.closed = true;
    this.wake?.();
  }

  async *[Symbol.asyncIterator]() {
    while (true) {
      while (this.queue.length) yield this.queue.shift()!;
      if (this.closed) return;
      await new Promise<void>((resolve) => (this.wake = resolve));
      this.wake = undefined;
    }
  }
}

// What a CLI process is started with. A spare's spec has no session yet.
interface Spec {
  cwd: string;
  backend: Backend;
  permissionMode: PermissionMode;
  sessionId?: string;
  // Continue the session as a copy instead of writing to it.
  forkSession?: boolean;
  copilot: boolean;
}

interface Session {
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
  // Parallel tool calls can ask at once; the card shows the oldest.
  pending: Pending[];
  toolIndex: Map<string, number>;
  idle?: ReturnType<typeof setTimeout>;
  // What this CLI process's cumulative cost totals are added to (see the result handler).
  costBase?: number;
  // Set once the drive loop has finished; the CLI is gone.
  ended?: boolean;
  done: Promise<void>;
}

const g = globalThis as unknown as {
  __threadboardSessions?: Map<string, Session>;
  __threadboardSpares?: Map<string, Session>;
  __threadboardLoginWaiters?: Map<Backend, Set<string>>;
};
const sessions = (g.__threadboardSessions ??= new Map<string, Session>());
const spares = (g.__threadboardSpares ??= new Map<string, Session>());
// Cards waiting for a CLI login to finish, to run again afterwards.
const loginWaiters = (g.__threadboardLoginWaiters ??= new Map<Backend, Set<string>>());

// setTimeout fires at once for anything longer than this.
const MAX_TIMER_MS = 2 ** 31 - 1;

// A fingerprint of this module's code. In development a code change reloads the module, but sessions
// the old code started keep running it, so idle ones are replaced instead of reused. It's derived from
// the code (not random) because each API route can load its own copy of this module.
const BUILD = createHash("sha1")
  .update([drive, handle, askUser, settle, sendMessage].map(String).join("\n"))
  .digest("hex");

function close(session: Session) {
  session.inbox.close();
  session.abort.abort();
}

function isStale(session: Session) {
  return session.ended || (session.build !== BUILD && !session.busy);
}

// Closes a card's CLI after the keep-alive time without messages (never, if that's 0).
function scheduleIdle(session: Session) {
  clearTimeout(session.idle);
  const cardId = session.cardId;
  const settingMinutes = keepAliveMinutes();
  // A picked-up session's CLI closes after 10 idle minutes at most, for the same reason.
  const imported = getCard(cardId ?? "")?.source === "claude-code";
  const minutes = imported ? Math.min(settingMinutes || 10, 10) : settingMinutes;
  if (!cardId || minutes <= 0) return;
  session.idle = setTimeout(() => closeWhenIdle(cardId, session), Math.min(minutes * 60_000, MAX_TIMER_MS));
}

// The card's open session, unless it's a stale one (which is closed here).
function currentSession(cardId: string): Session | undefined {
  const session = sessions.get(cardId);
  if (session && isStale(session)) {
    sessions.delete(cardId);
    close(session);
    return undefined;
  }
  return session;
}

let pukuPath: string | undefined;

function executableFor(backend: Backend) {
  if (backend !== "puku") return undefined;
  if (!pukuPath) {
    try {
      pukuPath = execFileSync("/usr/bin/which", ["puku-cli"], { encoding: "utf8" }).trim();
    } catch {
      throw new Error("puku-cli isn't on this app's PATH.");
    }
  }
  return pukuPath;
}

// The card may be deleted while its thread is still running.
function safeUpdate(id: string, patch: Partial<Card>) {
  if (getCard(id)) updateCard(id, patch);
}

function specFor(card: Card): Spec {
  return {
    cwd: card.cwd,
    backend: card.backend,
    permissionMode: card.permissionMode,
    sessionId: card.sessionId,
    copilot: card.role === "copilot",
  };
}

function spareKey(backend: Backend, cwd: string) {
  return `${backend}|${cwd}`;
}

function open(spec: Spec, cardId: string | null): Session {
  const executable = executableFor(spec.backend);
  const session: Session = {
    build: BUILD,
    cardId,
    spec,
    inbox: new Inbox(),
    abort: new AbortController(),
    busy: false,
    stopping: false,
    pending: [],
    toolIndex: new Map(),
    done: Promise.resolve(),
  };
  if (cardId) sessions.set(cardId, session);
  session.done = drive(session, executable);
  scheduleIdle(session);
  return session;
}

// A picked-up session that's open in another app, or that changed outside Weft in the last 10 minutes.
function activeElsewhere(card: Card) {
  if (card.source !== "claude-code" || !card.sessionId || card.forkedFrom) return false;
  const outside = (card.lastActivity ?? 0) > (card.lastWeftTurn ?? 0) + 5_000;
  if (outside && Date.now() - (card.lastActivity ?? 0) < 10 * 60_000) return true;
  return isOpenElsewhere(card.sessionId);
}

export function isBusy(cardId: string) {
  return sessions.get(cardId)?.busy ?? false;
}

// Starts a card's CLI without sending anything, so its next message starts right away.
export function warmUp(cardId: string) {
  const card = getCard(cardId);
  if (!card || currentSession(cardId)) return;
  // Picked-up sessions only start a CLI when you send something, so Weft never holds a session
  // the Claude app might reopen.
  if (card.source === "claude-code" || !fs.existsSync(card.cwd)) return;
  try {
    open(specFor(card), cardId);
  } catch {}
}

// Keeps a spare CLI open in a project folder for the next new card there.
export function ensureSpare(cwd: string, backend: Backend = "claude") {
  const key = spareKey(backend, cwd);
  const existing = spares.get(key);
  if (existing && !isStale(existing)) return;
  if (existing) {
    spares.delete(key);
    close(existing);
  }
  if (spares.size >= MAX_SPARES) {
    const [oldestKey, oldest] = spares.entries().next().value!;
    spares.delete(oldestKey);
    close(oldest);
  }
  try {
    // New cards default to bypassPermissions, so most take over a spare without a mode switch.
    spares.set(key, open({ cwd, backend, permissionMode: "bypassPermissions", copilot: false }, null));
  } catch {}
}

function adoptSpare(card: Card): Session | undefined {
  if (card.sessionId || card.role === "copilot") return undefined;
  const key = spareKey(card.backend, card.cwd);
  const spare = spares.get(key);
  if (!spare || spare.abort.signal.aborted || spare.ended) return undefined;
  spares.delete(key);
  if (isStale(spare)) {
    close(spare);
    return undefined;
  }
  spare.cardId = card.id;
  sessions.set(card.id, spare);
  if (card.permissionMode !== spare.spec.permissionMode) {
    spare.spec.permissionMode = card.permissionMode;
    void spare.query?.setPermissionMode(card.permissionMode).catch(() => {});
  }
  safeUpdate(card.id, { warm: true });
  scheduleIdle(spare);
  setTimeout(() => ensureSpare(card.cwd, card.backend), 0);
  return spare;
}

export function sendMessage(cardId: string, text: string, { echo = true } = {}) {
  const card = getCard(cardId);
  if (!card) throw new Error("No such card.");
  let session = currentSession(cardId);
  if (session?.busy) throw new Error("This thread is already running.");
  if (!session) {
    if (!fs.existsSync(card.cwd)) throw new Error(`This thread's folder ${card.cwd} doesn't exist anymore.`);
  }
  if (!session && activeElsewhere(card)) {
    // Two apps writing one session would split the conversation, so continue it as a copy.
    session = open({ ...specFor(card), forkSession: true }, cardId);
    updateCard(cardId, { forkedFrom: card.sessionId, openElsewhere: false });
  }
  session ??= adoptSpare(card) ?? open(specFor(card), cardId);

  if (echo) appendThread(cardId, { kind: "user", text, at: Date.now() });
  updateCard(cardId, { column: "running", error: undefined, pending: null, lastLine: "Thinking…" });
  clearTimeout(session.idle);
  session.busy = true;
  session.status = undefined;
  session.inbox.push(text);
}

// Ends the current turn but keeps the thread's CLI open.
export async function stop(cardId: string) {
  const session = sessions.get(cardId);
  if (!session) return;
  while (session.pending.length) settle(cardId, false);
  if (!session.busy) return;
  session.stopping = true;
  // If the CLI doesn't end the turn (it may still be starting, or stuck), end the process.
  setTimeout(() => {
    if (session.busy && session.stopping) session.abort.abort();
  }, 5_000);
  try {
    await Promise.race([session.query?.interrupt(), new Promise((resolve) => setTimeout(resolve, 5_000))]);
  } catch {
    session.abort.abort();
  }
}

// Closes the thread's CLI. Resolves once it has fully wound down.
export async function endSession(cardId: string) {
  const session = sessions.get(cardId);
  if (!session) return;
  while (session.pending.length) settle(cardId, false);
  sessions.delete(cardId);
  close(session);
  await session.done;
}

// pendingId ties the answer to the request the user saw; without it, the oldest one is answered.
export function answerPermission(cardId: string, allow: boolean, answers?: Record<string, string>, pendingId?: string) {
  const queue = sessions.get(cardId)?.pending ?? [];
  const target = pendingId ? queue.find((p) => p.id === pendingId) : queue[0];
  if (!target) throw new Error(pendingId ? "That request isn't waiting anymore." : "Nothing is waiting for an answer.");
  if (target.questions && allow && !answers) throw new Error("This thread asked a question, so it needs answers.");
  settle(cardId, allow, answers, target.id);
}

const boardActions = {
  start: (cardId: string, text: string) => sendMessage(cardId, text),
  stop,
  answer: answerPermission,
  isBusy,
};

// Runs the thread's last message again, in a fresh CLI (after a login, for example).
async function retry(cardId: string) {
  if (isBusy(cardId)) return;
  await endSession(cardId);
  const last = [...getThread(cardId)].reverse().find((item) => item?.kind === "user");
  if (last?.kind === "user" && getCard(cardId) && !isBusy(cardId)) sendMessage(cardId, last.text, { echo: false });
}

// Runs every card that was waiting on this CLI's login. Safe to call more than once.
export function retryAfterLogin(backend: Backend) {
  const waiting = loginWaiters.get(backend);
  if (!waiting?.size) return;
  loginWaiters.delete(backend);
  for (const cardId of waiting) {
    retry(cardId).catch((err) => safeUpdate(cardId, { error: err instanceof Error ? err.message : String(err) }));
  }
}

function needLogin(cardId: string, backend: Backend, message: string) {
  safeUpdate(cardId, {
    column: "needs_you",
    pending: null,
    error: message,
    lastLine: `Log in to ${CLI_NAMES[backend]} to run this thread`,
  });
  const waiting = loginWaiters.get(backend) ?? new Set<string>();
  waiting.add(cardId);
  loginWaiters.set(backend, waiting);
  try {
    startLogin(backend, () => retryAfterLogin(backend));
  } catch (err) {
    safeUpdate(cardId, { error: err instanceof Error ? err.message : String(err) });
  }
}

function settle(cardId: string, allow: boolean, answers?: Record<string, string>, pendingId?: string) {
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
  if (p.questions) {
    p.resolve(
      allow && answers
        ? { behavior: "allow", updatedInput: { ...p.input, answers } }
        : { behavior: "deny", message: "The user skipped the question." },
    );
  } else {
    p.resolve(
      allow
        ? { behavior: "allow", updatedInput: p.input }
        : { behavior: "deny", message: "The user denied this in Weft." },
    );
  }
  return true;
}

function pendingView(p: Pending) {
  return { id: p.id, toolName: p.toolName, title: p.title, input: p.input, questions: p.questions };
}

// The questions from an AskUserQuestion call, cleaned up for the board.
function readQuestions(input: Record<string, unknown>): Question[] | undefined {
  if (!Array.isArray(input.questions)) return undefined;
  const questions = input.questions
    .filter((q): q is Record<string, unknown> => Boolean(q) && typeof q === "object")
    .map((q) => ({
      question: String(q.question ?? ""),
      header: typeof q.header === "string" ? q.header : undefined,
      multiSelect: q.multiSelect === true,
      options: (Array.isArray(q.options) ? q.options : [])
        .filter((o): o is Record<string, unknown> => Boolean(o) && typeof o === "object")
        .map((o) => ({ label: String(o.label ?? ""), description: typeof o.description === "string" ? o.description : undefined }))
        .filter((o) => o.label),
    }))
    .filter((q) => q.question);
  return questions.length ? questions : undefined;
}

function askUser(
  cardId: string,
  session: Session,
  toolName: string,
  input: Record<string, unknown>,
  signal: AbortSignal,
  title?: string,
): Promise<PermissionResult> {
  return new Promise((resolve) => {
    const questions = toolName === "AskUserQuestion" ? readQuestions(input) : undefined;
    const summary = summarize(toolName, input);
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

// This app's own tools (the browser pane, and the copilot's read-only board tools) skip the prompt.
function isTrustedTool(toolName: string, source?: string) {
  if (source !== "sdk") return false;
  if (toolName.startsWith("mcp__browser__")) return true;
  return toolName.startsWith("mcp__board__") && SAFE_BOARD_TOOLS.has(toolName.slice("mcp__board__".length));
}

async function drive(session: Session, executable: string | undefined) {
  const { spec } = session;
  // Let open() finish registering the session before anything below can fail and clean it up.
  await Promise.resolve();
  try {
    session.query = query({
      prompt: session.inbox,
      options: {
        cwd: spec.cwd,
        resume: spec.sessionId,
        forkSession: spec.sessionId ? spec.forkSession : undefined,
        env: cliEnv(),
        abortController: session.abort,
        includePartialMessages: true,
        permissionMode: spec.permissionMode,
        // So a card can switch to bypassPermissions later, including a spare it takes over.
        allowDangerouslySkipPermissions: !spec.copilot,
        pathToClaudeCodeExecutable: executable,
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
          append: spec.copilot ? `${BROWSER_PROMPT}\n\n${COPILOT_PROMPT}` : `${BROWSER_PROMPT}\n\n${threadPrompt()}`,
        },
        mcpServers: spec.copilot
          ? { browser: browserMcpServer(), board: boardMcpServer(boardActions) }
          : { browser: browserMcpServer() },
        canUseTool: (toolName, input, opts) => {
          if (isTrustedTool(toolName, opts.mcpServer?.source)) {
            return Promise.resolve({ behavior: "allow", updatedInput: input });
          }
          if (!session.cardId) return Promise.resolve({ behavior: "deny", message: "No card is attached yet." });
          return askUser(session.cardId, session, toolName, input, opts.signal, opts.title);
        },
        stderr: (data) => console.error(`[thread ${(session.cardId ?? "spare").slice(0, 8)}] ${data.trimEnd()}`),
      },
    });
    if (session.cardId) safeUpdate(session.cardId, { warm: true });
    for await (const msg of session.query) {
      const cardId = session.cardId;
      // A spare's startup messages belong to no card yet.
      if (!cardId) continue;
      if (!getCard(cardId)) {
        session.abort.abort();
        break;
      }
      handle(cardId, session, msg);
    }
  } catch (err) {
    const cardId = session.cardId;
    if (cardId && !session.abort.signal.aborted) {
      const message = err instanceof Error ? err.message : String(err);
      if (isNotLoggedInError(message)) needLogin(cardId, spec.backend, message);
      else safeUpdate(cardId, { error: message });
    }
  } finally {
    session.ended = true;
    clearTimeout(session.idle);
    const cardId = session.cardId;
    if (!cardId) {
      for (const [key, spare] of spares) if (spare === session) spares.delete(key);
    } else if (!sessions.has(cardId) || sessions.get(cardId) === session) {
      // (A session that was replaced by a newer one leaves the card to it.)
      if (sessions.get(cardId) === session) sessions.delete(cardId);
      const latest = getCard(cardId);
      if (latest) {
        const live = latest.column === "running" || Boolean(latest.pending);
        updateCard(cardId, {
          warm: false,
          ...(live ? { column: "review" as const, pending: null, lastLine: "Stopped" } : {}),
        });
      }
    }
  }
}

function closeWhenIdle(cardId: string, session: Session) {
  if (sessions.get(cardId) !== session || session.busy) return;
  sessions.delete(cardId);
  session.inbox.close();
  // If the CLI doesn't exit on its own once its input ends, end it.
  setTimeout(() => session.abort.abort(), 10_000);
}

function handle(id: string, session: Session, msg: SDKMessage) {
  switch (msg.type) {
    case "system":
      if (msg.subtype === "init") safeUpdate(id, { sessionId: msg.session_id });
      break;

    case "stream_event": {
      if (msg.parent_tool_use_id) break;
      const ev = msg.event;
      if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
        publish({ type: "delta", cardId: id, text: ev.delta.text });
      }
      break;
    }

    case "assistant":
      // Subagent turns stay out of the card's thread; their final report arrives as a tool result.
      if (msg.parent_tool_use_id) break;
      for (const block of msg.message.content) {
        if (block.type === "text") {
          const { text, status } = extractStatus(block.text);
          if (status) {
            session.status = status;
            safeUpdate(id, { stage: status.stage, remaining: status.remaining });
          }
          if (text.trim()) {
            appendThread(id, { kind: "assistant", text, at: Date.now() });
            safeUpdate(id, { lastLine: firstLine(text) });
          }
        } else if (block.type === "tool_use") {
          const input = (block.input ?? {}) as Record<string, unknown>;
          const summary = summarize(block.name, input);
          const index = appendThread(id, { kind: "tool", id: block.id, name: block.name, summary, at: Date.now() });
          session.toolIndex.set(block.id, index);
          safeUpdate(id, { lastLine: `${shortToolName(block.name)} ${summary}`.trim() });
        }
      }
      break;

    case "user": {
      const content = msg.message.content;
      if (!Array.isArray(content)) break;
      for (const block of content) {
        if (block.type !== "tool_result") continue;
        const index = session.toolIndex.get(block.tool_use_id);
        if (index === undefined) continue;
        const item = getThread(id)[index];
        if (item?.kind !== "tool") continue;
        replaceThreadItem(id, index, { ...item, result: resultText(block.content), isError: Boolean(block.is_error) });
      }
      break;
    }

    case "result": {
      const stopped = session.stopping;
      const ok = msg.subtype === "success";
      const parsed = ok ? extractStatus(msg.result) : { text: `Ended early: ${msg.subtype.replace(/_/g, " ")}` };
      const summary = stopped ? "Stopped" : parsed.text;
      const isError = !stopped && msg.is_error;
      session.busy = false;
      session.stopping = false;

      if (isError && isNotLoggedInError(summary)) {
        appendThread(id, { kind: "result", text: summary, isError: true, at: Date.now() });
        needLogin(id, session.spec.backend, summary);
        break;
      }

      const status = parsed.status ?? session.status;
      // Totals are cumulative within a CLI process. A resumed session usually starts from its saved
      // total; when it doesn't, this process's totals are added to what the card had before.
      const previous = getCard(id)?.costUsd ?? 0;
      session.costBase ??= msg.total_cost_usd >= previous ? 0 : previous;
      const costUsd = session.costBase + msg.total_cost_usd;
      appendThread(id, { kind: "result", text: summary, costUsd, isError, at: Date.now() });
      safeUpdate(id, {
        sessionId: msg.session_id,
        column: stopped || isError ? "review" : (status?.column ?? "review"),
        pending: null,
        costUsd,
        turns: (getCard(id)?.turns ?? 0) + 1,
        lastActivity: Date.now(),
        lastWeftTurn: Date.now(),
        lastLine: firstLine(summary) || "Done",
        error: isError ? summary : undefined,
        ...(status ? { stage: status.stage, remaining: status.remaining } : {}),
      });
      scheduleIdle(session);
      break;
    }
  }
}

function summarize(name: string, input: Record<string, unknown>) {
  for (const key of ["command", "file_path", "path", "pattern", "url", "query", "selector", "description", "prompt"]) {
    const value = input[key];
    if (typeof value === "string" && value) return clip(value, 100);
  }
  const json = JSON.stringify(input);
  return json === "{}" ? "" : clip(json, 100);
}

function resultText(content: unknown): string {
  if (typeof content === "string") return clip(content, 4000);
  if (!Array.isArray(content)) return "";
  const parts = content.map((b: { type?: string; text?: string }) => (b.type === "text" ? (b.text ?? "") : `[${b.type}]`));
  return clip(parts.join("\n"), 4000);
}

function firstLine(text: string) {
  const line = text.split("\n").find((l) => l.trim()) ?? "";
  return clip(line.trim(), 140);
}

function clip(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
