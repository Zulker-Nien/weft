import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { query, type ModelUsage, type Options, type PermissionResult, type Query, type SDKMessage, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { messageContent } from "./attachments";
import { isDoneCommand, skillsForPrompt } from "./automations";
import { COPILOT_PROMPT, boardMcpServer, describeBoardTool, isTrustedTool, threadBoardMcpServer } from "./board-tools";
import { BROWSER_PROMPT, browserMcpServer } from "./browser-tools";
import { publish } from "./bus";
import { firstLine, shortToolName, summarizeInput, toolAction } from "./format";
import { cliEnv } from "./env";
import { glanceAfterTurn, showStarter } from "./glance";
import { isOpenElsewhere } from "./import";
import { isNotLoggedInError, startLogin } from "./login";
import { editedPath, touchFile } from "./overlap";
import { defaultPermissionMode, keepAliveMinutes, threadPrompt } from "./settings";
import { PLUGIN_DIR } from "./skills";
import { extractReview, REVIEW_PROMPT } from "./review";
import { extractStatus, type BoardStatus } from "./status";
import { appendThread, getCard, getThread, replaceThreadItem, updateCard } from "./store";
import { adoptLocalMedia, toolResult } from "./thread-media";
import * as turnRules from "./turn";
import { columnAfterTurn, eventWindow, modelStats, readQuestions, readResult, turnCost, usageWindow } from "./turn";
import type { Backend, Card, CardStats, Effort, PermissionMode, Question } from "./types";

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
  model?: string;
  effort?: Effort;
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
  // Tokens the last main-agent request sent in, which is how full the context window is.
  contextTokens?: number;
  // The CLI's session id from its init, kept while a spare so the card that adopts it can resume.
  sessionId?: string;
  // Set once the drive loop has finished; the CLI is gone.
  ended?: boolean;
  done: Promise<void>;
}

const g = globalThis as unknown as {
  __threadboardSessions?: Map<string, Session>;
  __threadboardSpares?: Map<string, Session>;
  __threadboardLoginWaiters?: Map<Backend, Set<string>>;
  __weftQueued?: Map<string, string[]>;
  __weftArchiveAfter?: Set<string>;
};
const sessions = (g.__threadboardSessions ??= new Map<string, Session>());
const spares = (g.__threadboardSpares ??= new Map<string, Session>());
// Cards waiting for a CLI login to finish, to run again afterwards.
const loginWaiters = (g.__threadboardLoginWaiters ??= new Map<Backend, Set<string>>());
// Messages waiting to run on a card one turn at a time, such as the skills of board automations.
const queued = (g.__weftQueued ??= new Map<string, string[]>());
// Cards moved to Done: archived once the queued Done skills have all run.
const archiveAfter = (g.__weftArchiveAfter ??= new Set<string>());

// setTimeout fires at once for anything longer than this.
const MAX_TIMER_MS = 2 ** 31 - 1;

// A fingerprint of this module's code. In development a code change reloads the module, but sessions
// the old code started keep running it, so idle ones are replaced instead of reused. It's derived from
// the code (not random) because each API route can load its own copy of this module. The pure turn
// rules in turn.ts count too: a session started before they changed would still run the old ones.
const BUILD = createHash("sha1")
  .update(
    [drive, queryOptions, handle, handleAssistant, recordEdit, handleToolResults, handleResult, askUser, settle, sendMessage, ...Object.values(turnRules)]
      .map(String)
      .join("\n"),
  )
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
    model: card.model,
    effort: card.effort,
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

// Saves a card's permission mode and applies it to its open CLI, mid-turn included.
export function setPermissionMode(cardId: string, mode: PermissionMode) {
  updateCard(cardId, { permissionMode: mode });
  const session = sessions.get(cardId);
  if (!session || session.spec.permissionMode === mode) return;
  session.spec.permissionMode = mode;
  void session.query?.setPermissionMode(mode).catch(() => {});
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
    // Spares start in the default mode new cards get, so most take one over without a mode switch.
    spares.set(key, open({ cwd, backend, permissionMode: defaultPermissionMode(), copilot: false }, null));
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
  if (card.model && card.model !== spare.spec.model) {
    spare.spec.model = card.model;
    void spare.query?.setModel(card.model).catch(() => {});
  }
  if (card.effort && card.effort !== spare.spec.effort) {
    spare.spec.effort = card.effort;
    void spare.query?.applyFlagSettings({ effortLevel: card.effort }).catch(() => {});
  }
  // The spare's init came before it had a card; without its id a CLI that dies mid-turn can't resume.
  safeUpdate(card.id, { warm: true, ...(spare.sessionId ? { sessionId: spare.sessionId } : {}) });
  scheduleIdle(spare);
  setTimeout(() => ensureSpare(card.cwd, card.backend), 0);
  return spare;
}

// `cli` is what the CLI gets when it differs from what the thread shows (the copilot's board digest).
export function sendMessage(cardId: string, text: string, { echo = true, cli = text } = {}) {
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
  updateCard(cardId, { column: "running", archived: false, error: undefined, pending: null, lastLine: "Thinking…" });
  clearTimeout(session.idle);
  session.busy = true;
  session.status = undefined;
  session.openedPane = false;
  session.turnSeq = (session.turnSeq ?? 0) + 1;
  session.inbox.push(cli);
  if (!session.spec.copilot) showStarter(cardId, card.title, text).catch(() => {});
}

// A message you typed: sent now (a /done one archives the card once it's run), then the skills that "a prompt matches" rules want for it follow as
// their own turns, once per thread per skill.
export function sendUserMessage(cardId: string, text: string, { cli = text } = {}) {
  const card = getCard(cardId);
  if (!card) throw new Error("No such card.");
  sendMessage(cardId, text, { cli });
  // /done files the card away when its turn ends, as a move to Done does.
  if (isDoneCommand(text)) archiveWhenIdle(cardId);
  const skills = skillsForPrompt(card, text);
  if (!skills.length) return;
  updateCard(cardId, { promptSkills: [...(card.promptSkills ?? []), ...skills] });
  queueMessages(cardId, skills.map((skill) => `/${skill}`));
}

// Runs each message as its own turn, in order, starting now if the card is idle. A turn that's
// stopped or fails drops the rest; one that ends needing you waits for your reply's turn to end.
export function queueMessages(cardId: string, texts: string[]) {
  if (!texts.length) return;
  queued.set(cardId, [...(queued.get(cardId) ?? []), ...texts]);
  sendQueued(cardId);
}

// Archives the card in Done once the messages queued for it have run (now, if there are none). A
// stopped or failed turn leaves it in Done, unarchived, and so does a starred one (it's in the library).
export function archiveWhenIdle(cardId: string) {
  if (queued.has(cardId) || isBusy(cardId)) archiveAfter.add(cardId);
  else updateCard(cardId, { archived: !getCard(cardId)?.libraryId });
}

function sendQueued(cardId: string) {
  if (isBusy(cardId)) return;
  const queue = queued.get(cardId) ?? [];
  const text = queue.shift();
  if (!queue.length) queued.delete(cardId);
  if (!text) return;
  try {
    sendMessage(cardId, text);
  } catch (err) {
    queued.delete(cardId);
    safeUpdate(cardId, { error: err instanceof Error ? err.message : String(err) });
  }
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

// What a session's CLI is started with: its spec, Weft's prompts, tools and skills, and the permission hook.
function queryOptions(session: Session, executable: string | undefined): Options {
  const { spec } = session;
  const cardId = () => session.cardId ?? undefined;
  return {
    cwd: spec.cwd,
    resume: spec.sessionId,
    forkSession: spec.sessionId ? spec.forkSession : undefined,
    env: cliEnv(),
    abortController: session.abort,
    includePartialMessages: true,
    permissionMode: spec.permissionMode,
    model: spec.model,
    effort: spec.effort,
    // So a card can switch to bypassPermissions later, including a spare it takes over.
    // Puku-cli's CLI doesn't accept this flag, so only forward it to the Claude Code binary.
    allowDangerouslySkipPermissions: spec.backend === "claude" && !spec.copilot ? true : undefined,
    pathToClaudeCodeExecutable: executable,
    // Weft's own skills (plugin/skills), so board threads can run /weft:done and the like.
    plugins: !spec.copilot && fs.existsSync(PLUGIN_DIR) ? [{ type: "local", path: PLUGIN_DIR }] : undefined,
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      append: spec.copilot ? `${BROWSER_PROMPT}\n\n${COPILOT_PROMPT}` : `${BROWSER_PROMPT}\n\n${threadPrompt()}\n\n${REVIEW_PROMPT}`,
    },
    mcpServers: {
      browser: browserMcpServer(cardId),
      board: spec.copilot ? boardMcpServer(boardActions) : threadBoardMcpServer(cardId, boardActions),
    },
    canUseTool: (toolName, input, opts) => {
      if (isTrustedTool(toolName, opts.mcpServer?.source)) {
        return Promise.resolve({ behavior: "allow", updatedInput: input });
      }
      if (!session.cardId) return Promise.resolve({ behavior: "deny", message: "No card is attached yet." });
      return askUser(session.cardId, session, toolName, input, opts.signal, opts.title);
    },
    stderr: (data) => console.error(`[thread ${(session.cardId ?? "spare").slice(0, 8)}] ${data.trimEnd()}`),
  };
}

async function drive(session: Session, executable: string | undefined) {
  // Let open() finish registering the session before anything below can fail and clean it up.
  await Promise.resolve();
  try {
    session.query = query({ prompt: session.inbox, options: queryOptions(session, executable) });
    if (session.cardId) safeUpdate(session.cardId, { warm: true });
    for await (const msg of session.query) {
      const cardId = session.cardId;
      if (msg.type === "system" && msg.subtype === "init") session.sessionId = msg.session_id;
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
      if (isNotLoggedInError(message)) needLogin(cardId, session.spec.backend, message);
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
        // The CLI ended mid-turn, so whatever was queued after that turn doesn't run.
        if (live) queued.delete(cardId);
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
      if (msg.subtype === "init") {
        safeUpdate(id, { sessionId: msg.session_id });
        void refreshLimits(id, session);
      }
      break;

    case "rate_limit_event": {
      const info = msg.rate_limit_info;
      const window = eventWindow(info);
      if (!window) break;
      if (info.rateLimitType === "five_hour") updateStats(id, { fiveHour: window });
      else if (info.rateLimitType === "seven_day") updateStats(id, { sevenDay: window });
      break;
    }

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
      if (!msg.parent_tool_use_id) handleAssistant(id, session, msg);
      break;

    case "user":
      handleToolResults(id, session, msg);
      break;

    case "result":
      handleResult(id, session, msg);
      break;
  }
}

// The agent's reply: its text goes to the thread (status and review blocks lifted onto the card), and
// each tool call gets a thread item its result fills in later.
function handleAssistant(id: string, session: Session, msg: Extract<SDKMessage, { type: "assistant" }>) {
  const u = msg.message.usage;
  if (u) session.contextTokens = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
  for (const block of msg.message.content) {
    if (block.type === "text") {
      const { text: withReview, status } = extractStatus(block.text);
      const { text, review } = extractReview(withReview);
      if (review) safeUpdate(id, { review });
      if (status) {
        session.status = status;
        safeUpdate(id, { stage: status.stage, remaining: status.remaining });
      }
      if (text.trim()) {
        appendThread(id, { kind: "assistant", text: adoptLocalMedia(text, session.spec.cwd), at: Date.now() });
        safeUpdate(id, { lastLine: firstLine(text) });
      }
    } else if (block.type === "tool_use") {
      const input = (block.input ?? {}) as Record<string, unknown>;
      const summary = summarizeInput(input);
      const action = toolAction(block.name, input);
      if (block.name === "mcp__browser__open_url") session.openedPane = true;
      recordEdit(id, block.name, input);
      const index = appendThread(id, { kind: "tool", id: block.id, name: block.name, summary, action, at: Date.now() });
      session.toolIndex.set(block.id, index);
      safeUpdate(id, { lastLine: `${shortToolName(block.name)} ${summary}`.trim() });
    }
  }
}

// Keeps the file an edit tool call names on the card, for the shared-files warning (lib/overlap.ts).
// It's recorded when the call is made, so a denied edit counts too; the list lasts the card's life,
// across turns, because the warning is about uncommitted edits in a shared tree and Weft can't
// cheaply tell what got committed. Writes only when the list changes: this runs on every tool call.
function recordEdit(id: string, toolName: string, input: Record<string, unknown>) {
  const path = editedPath(toolName, input);
  if (!path) return;
  const touched = touchFile(getCard(id)?.touchedFiles, path);
  if (touched) safeUpdate(id, { touchedFiles: touched });
}

// Tool results fill in the tool items the assistant message added.
function handleToolResults(id: string, session: Session, msg: Extract<SDKMessage, { type: "user" }>) {
  const content = msg.message.content;
  if (!Array.isArray(content)) return;
  for (const block of content) {
    if (block.type !== "tool_result") continue;
    const index = session.toolIndex.get(block.tool_use_id);
    if (index === undefined) continue;
    const item = getThread(id)[index];
    if (item?.kind !== "tool") continue;
    replaceThreadItem(id, index, { ...item, ...toolResult(block.content), isError: Boolean(block.is_error) });
  }
}

// The turn ended: settle the card (column, cost, stats), then archive it or send what was queued.
function handleResult(id: string, session: Session, msg: Extract<SDKMessage, { type: "result" }>) {
  const stopped = session.stopping;
  const parsed = readResult({
    subtype: msg.subtype,
    result: msg.subtype === "success" ? msg.result : undefined,
    isError: msg.is_error,
    stopped,
  });
  const { summary, isError } = parsed;
  session.busy = false;
  session.stopping = false;

  if (isError && isNotLoggedInError(summary)) {
    appendThread(id, { kind: "result", text: summary, isError: true, at: Date.now() });
    needLogin(id, session.spec.backend, summary);
    return;
  }

  const status = parsed.status ?? session.status;
  const cost = turnCost(getCard(id)?.costUsd ?? 0, msg.total_cost_usd, session.costBase);
  session.costBase = cost.base;
  const costUsd = cost.costUsd;
  appendThread(id, { kind: "result", text: summary, costUsd, isError, at: Date.now() });
  safeUpdate(id, {
    sessionId: msg.session_id,
    column: columnAfterTurn(stopped, isError, status),
    pending: null,
    costUsd,
    turns: (getCard(id)?.turns ?? 0) + 1,
    lastActivity: Date.now(),
    lastWeftTurn: Date.now(),
    stats: turnStats(id, session, msg.modelUsage),
    lastLine: firstLine(summary) || "Done",
    error: isError ? summary : undefined,
    ...(status ? { stage: status.stage, remaining: status.remaining } : {}),
  });
  scheduleIdle(session);
  if (!session.spec.copilot) glanceAfter(id, session, { reply: parsed.summary, isError, stopped });
  if (archiveAfter.has(id) && (stopped || isError)) archiveAfter.delete(id);
  else if (archiveAfter.has(id) && !queued.has(id) && status?.column !== "needs_you") {
    archiveAfter.delete(id);
    // A starred card is in the library, so it stays on the board too.
    safeUpdate(id, { column: "done", archived: !getCard(id)?.libraryId });
  }
  if (queued.has(id)) {
    if (stopped || isError) queued.delete(id);
    // Once the drive loop has handled this result, so the next turn starts on a settled card.
    else if (status?.column !== "needs_you") setTimeout(() => sendQueued(id), 0);
  }
}

// A teammate's update page for the pane when the turn showed nothing (lib/glance.ts), written in the background.
function glanceAfter(id: string, session: Session, turn: { reply: string; isError: boolean; stopped: boolean }) {
  const ask = getThread(id).findLast((item) => item.kind === "user");
  const seq = session.turnSeq;
  const turnInfo = { ...turn, ask: ask?.kind === "user" ? ask.text : "", openedPane: Boolean(session.openedPane) };
  glanceAfterTurn(id, turnInfo, () => session.turnSeq === seq && !session.busy).catch(() => {});
}

// The plan's 5-hour and weekly usage, asked of the CLI so it shows before any rate-limit event.
async function refreshLimits(id: string, session: Session) {
  try {
    const usage = await session.query?.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true });
    const limits = usage?.rate_limits;
    if (!limits) return;
    updateStats(id, { fiveHour: usageWindow(limits.five_hour), sevenDay: usageWindow(limits.seven_day) });
  } catch {}
}

function updateStats(id: string, patch: Partial<CardStats>) {
  safeUpdate(id, { stats: { ...getCard(id)?.stats, ...patch } });
}

// The status strip's numbers after a turn: model, context fill, tokens, and the folder's changed lines.
function turnStats(id: string, session: Session, modelUsage: Record<string, ModelUsage>): CardStats {
  return {
    ...getCard(id)?.stats,
    ...modelStats(modelUsage, session.contextTokens),
    ...changedLines(session.spec.cwd),
    branch: gitBranch(session.spec.cwd),
  };
}

function gitBranch(cwd: string) {
  try {
    return execFileSync("git", ["-C", cwd, "--no-optional-locks", "rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8", timeout: 3000 }).trim() || undefined;
  } catch {
    return undefined;
  }
}

function changedLines(cwd: string) {
  try {
    const out = execFileSync("git", ["-C", cwd, "--no-optional-locks", "diff", "HEAD", "--numstat"], { encoding: "utf8", timeout: 3000 });
    let added = 0;
    let removed = 0;
    for (const line of out.split("\n")) {
      const [a, r] = line.split("\t");
      added += Number(a) || 0;
      removed += Number(r) || 0;
    }
    return { added, removed };
  } catch {
    return { added: undefined, removed: undefined };
  }
}
