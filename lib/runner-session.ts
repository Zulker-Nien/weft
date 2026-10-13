import fs from "node:fs";
import { createHash } from "node:crypto";
import { query, type Options } from "@anthropic-ai/claude-agent-sdk";
import { signAsWeft } from "./attribution";
import { COPILOT_PROMPT, boardMcpServer, isTrustedTool, threadBoardMcpServer } from "./board-tools";
import { boardViewMcpServer } from "./board-view-tools";
import { BROWSER_PROMPT, browserMcpServer } from "./browser-tools";
import { runsOn } from "./cli-defaults";
import { executableFor } from "./cli-path";
import { claimQuestion } from "./claim-guard";
import { guardedCli, RESTART_PROMPT } from "./env";
import { isNotLoggedInError, isRateLimitError } from "./login";
import { hitRateLimit } from "./rate-limit";
import { REVIEW_PROMPT } from "./review";
import { askUser, settle } from "./runner-ask";
import { close, hooks, Inbox, queued, safeUpdate, scheduleIdle, sessions, spares, specFor, type Session, type Spec } from "./runner-state";
import { TURN_CODE, handle } from "./runner-turn";
import { SECRETS_PROMPT, secretsMcpServer } from "./secret-tools";
import { defaultPermissionMode, subagentModel, threadPrompt } from "./settings";
import { trialOptions } from "./puku-trial";
import { PLUGIN_DIR } from "./skills";
import { switchSpare } from "./spare-switch";
import { subagentEnv, subagentPrompt } from "./subagents";
import { getCard, updateCard } from "./store";
import * as turnRules from "./turn";
import type { Backend, Card } from "./types";

// A thread's CLI process: started (or a spare taken over), driven through the Agent SDK until it ends,
// and replaced when the code it runs is out of date.

// Spare CLIs started ahead of time, one per recent project folder, so a new card doesn't wait.
const MAX_SPARES = 3;

// A fingerprint of the runner's code. In development a code change reloads the module, but sessions
// the old code started keep running it, so idle ones are replaced instead of reused. It's derived from
// the code (not random) because each API route can load its own copy of these modules. The pure turn
// rules in turn.ts count too: a session started before they changed would still run the old ones.
const BUILD = createHash("sha1")
  .update([drive, queryOptions, threadEnv, ...TURN_CODE, askUser, settle, ...Object.values(turnRules)].map(String).join("\n"))
  .digest("hex");

// The code fingerprint plus the settings a CLI only reads when it starts (the thread prompt, the subagent
// model), so changing one in Settings replaces idle sessions too.
function currentBuild() {
  const started = createHash("sha1").update(`${threadPrompt()}\n${subagentModel()}`).digest("hex").slice(0, 12);
  return `${BUILD}:${started}`;
}

function isStale(session: Session) {
  return session.ended || (session.build !== currentBuild() && !session.busy);
}

// The card's open session, unless it's a stale one (which is closed here).
export function currentSession(cardId: string): Session | undefined {
  const session = sessions.get(cardId);
  if (session && isStale(session)) {
    sessions.delete(cardId);
    close(session);
    return undefined;
  }
  return session;
}

function spareKey(backend: Backend, cwd: string) {
  return `${backend}|${cwd}`;
}

export function open(spec: Spec, cardId: string | null): Session {
  const executable = executableFor(spec.backend);
  const session: Session = {
    build: currentBuild(),
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
  const oldest = spares.entries().next().value;
  if (spares.size >= MAX_SPARES && oldest) {
    spares.delete(oldest[0]);
    close(oldest[1]);
  }
  try {
    // Spares start in the default mode new cards get, so most take one over without a mode switch.
    spares.set(key, open({ cwd, backend, permissionMode: defaultPermissionMode(), copilot: false }, null));
  } catch {}
}

export function adoptSpare(card: Card): Session | undefined {
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
  switchSpare(spare.query, spare.spec, card);
  // The spare's init came before it had a card; without its id a CLI that dies mid-turn can't resume.
  // Its model is the CLI's default unless the switch above gave it the card's.
  const ran = runsOn(card.model ?? spare.model, card);
  safeUpdate(card.id, { warm: true, ...(spare.sessionId ? { sessionId: spare.sessionId } : {}), ...(ran ? { stats: { ...card.stats, runsOn: ran } } : {}) });
  scheduleIdle(spare);
  setTimeout(() => ensureSpare(card.cwd, card.backend), 0);
  return spare;
}

// The copilot runs the board, not code, so subagent settings are for threads only.
function threadEnv(spec: Spec, env: Options["env"], subagents: ReturnType<typeof subagentModel>) {
  return spec.copilot ? env : { ...env, ...subagentEnv(subagents, spec.backend) };
}

// What a session's CLI is started with: its spec, Weft's prompts, tools and skills, and the permission hook.
function queryOptions(session: Session, executable: string | undefined): Options {
  const { spec } = session;
  const cardId = () => session.cardId ?? undefined;
  const guarded = guardedCli(() => [...sessions.values()].filter((s) => s.busy && s !== session).length, cardId);
  const subagents = subagentModel();
  // A puku thread with no Puku login of its own runs on Weft's Puku trial while you're signed in to Weft.
  const trial = spec.backend === "puku" ? trialOptions() : null;
  return {
    cwd: spec.cwd,
    resume: spec.sessionId,
    forkSession: spec.sessionId ? spec.forkSession : undefined,
    resumeSessionAt: spec.sessionId ? spec.resumeAt : undefined,
    ...guarded,
    env: { ...threadEnv(spec, guarded.env, subagents), ...trial?.env },
    settings: trial?.settings,
    abortController: session.abort,
    includePartialMessages: true,
    permissionMode: spec.permissionMode,
    model: spec.model,
    effort: spec.effort,
    // So a card can switch to bypassPermissions later, including a spare it takes over.
    // Puku-cli's CLI doesn't accept this flag, so only forward it to the Claude Code binary.
    allowDangerouslySkipPermissions: spec.backend === "claude" && !spec.copilot ? true : undefined,
    pathToClaudeCodeExecutable: executable,
    // A guessed next message after each turn, for the reply box's Tab (it rides the turn's prompt cache).
    promptSuggestions: spec.backend === "claude" && !spec.copilot ? true : undefined,
    // Weft's own skills (plugin/skills), so board threads can run /weft:done and the like.
    plugins: !spec.copilot && fs.existsSync(PLUGIN_DIR) ? [{ type: "local", path: PLUGIN_DIR }] : undefined,
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      append: spec.copilot ? `${BROWSER_PROMPT}\n\n${COPILOT_PROMPT}` : `${BROWSER_PROMPT}\n\n${SECRETS_PROMPT}\n\n${RESTART_PROMPT}\n\n${subagentPrompt(subagents, spec.backend)}\n\n${threadPrompt()}\n\n${REVIEW_PROMPT}`,
    },
    mcpServers: {
      browser: browserMcpServer(cardId),
      // Threads only: the copilot runs the board, not a project.
      ...(spec.copilot ? {} : { secrets: secretsMcpServer(cardId, () => spec.cwd), board_view: boardViewMcpServer() }),
      board: spec.copilot ? boardMcpServer(hooks.boardActions) : threadBoardMcpServer(cardId, hooks.boardActions),
    },
    canUseTool: (toolName, input, opts) => {
      if (isTrustedTool(toolName, opts.mcpServer?.source)) {
        return Promise.resolve({ behavior: "allow", updatedInput: input });
      }
      if (!session.cardId) return Promise.resolve({ behavior: "deny", message: "No card is attached yet." });
      // A symbol-claim clash (lib/claim-guard.ts) asks in its own words.
      return askUser(session.cardId, session, toolName, input, opts.signal, claimQuestion(opts.toolUseID) ?? opts.title);
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
      if (msg.type === "system" && msg.subtype === "init") [session.sessionId, session.model] = [msg.session_id, msg.model];
      if (msg.type === "system" && msg.subtype === "init") signAsWeft(session.query, session.spec, session.spec.model ?? msg.model);
      // A spare's startup messages belong to no card yet.
      if (!cardId) continue;
      if (!getCard(cardId)) {
        session.abort.abort();
        break;
      }
      await handle(cardId, session, msg);
    }
  } catch (err) {
    failed(session, err);
  } finally {
    wrapUp(session);
  }
}

// The CLI failed (not stopped by us): a plan limit, a logged-out CLI, or an error kept on the card.
function failed(session: Session, err: unknown) {
  const cardId = session.cardId;
  if (!cardId || session.abort.signal.aborted) return;
  const message = err instanceof Error ? err.message : String(err);
  if (isRateLimitError(message)) hitRateLimit(cardId, session.spec.backend, message);
  else if (isNotLoggedInError(message)) hooks.needLogin(cardId, session.spec.backend, message);
  else safeUpdate(cardId, { error: message });
}

// The CLI is gone: forget the session, and a card it left mid-turn goes to Review.
function wrapUp(session: Session) {
  session.ended = true;
  clearTimeout(session.idle);
  const cardId = session.cardId;
  if (!cardId) {
    for (const [key, spare] of spares) if (spare === session) spares.delete(key);
    return;
  }
  // (A session that was replaced by a newer one leaves the card to it.)
  if (sessions.has(cardId) && sessions.get(cardId) !== session) return;
  sessions.delete(cardId);
  const latest = getCard(cardId);
  if (!latest) return;
  const live = latest.column === "running" || Boolean(latest.pending);
  // The CLI ended mid-turn, so whatever was queued after that turn doesn't run.
  if (live) queued.delete(cardId);
  updateCard(cardId, {
    warm: false,
    ...(live ? { column: "review" as const, pending: null, lastLine: "Stopped" } : {}),
  });
}
