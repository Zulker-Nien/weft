import type { ModelUsage, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { publish } from "./bus";
import { firstLine, shortToolName, summarizeInput, toolAction } from "./format";
import { runsOn } from "./cli-defaults";
import { changedLines, gitBranch } from "./git-stats";
import { showAfterTurn } from "./show";
import { isNotLoggedInError, isRateLimitError } from "./login";
import { editedPath, touchFile } from "./overlap";
import { hitRateLimit } from "./rate-limit";
import { extractReview } from "./review";
import { archiveAfter, hooks, queued, safeUpdate, scheduleIdle, type Session } from "./runner-state";
import { handleTaskEvent } from "./runner-tasks";
import { restoreDoneOverride } from "./runner";
import { withRedacted } from "./secret-run";
import { secretAskOf } from "./vault-view";
import { extractStatus, type BoardStatus } from "./status";
import { appendThread, getCard, getThread, replaceThreadItem } from "./store";
import { adoptLocalMedia, liveToolResult, type ToolResult } from "./thread-media";
import { cacheAfter, columnAfterTurn, eventWindow, modelStats, readResult, turnCost, usageWindow } from "./turn";
import type { CardStats } from "./types";

// What a card's CLI sends during a turn, put on the card and its thread: streamed text, replies, tool calls
// and results, rate limits, and the result that ends the turn (lib/runner-session.ts's drive loop calls handle).

// Sync except for tool results from a card that used vault secrets, which wait on their redaction.
export function handle(id: string, session: Session, msg: SDKMessage): void | Promise<void> {
  switch (msg.type) {
    case "system":
      if (msg.subtype === "init") {
        safeUpdate(id, { sessionId: msg.session_id });
        const card = getCard(id);
        const ran = card && runsOn(msg.model, card);
        if (ran) updateStats(id, { runsOn: ran });
        void refreshLimits(id, session);
      } else handleTaskEvent(id, session, msg);
      break;

    case "rate_limit_event":
      handleRateLimit(id, msg.rate_limit_info);
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
      if (!msg.parent_tool_use_id) handleAssistant(id, session, msg);
      break;

    case "user":
      return handleToolResults(id, session, msg);

    case "result":
      handleResult(id, session, msg);
      break;

    case "prompt_suggestion":
      handleSuggestion(id, msg.suggestion);
      break;
  }
}

function handleRateLimit(id: string, info: Extract<SDKMessage, { type: "rate_limit_event" }>["rate_limit_info"]) {
  const window = eventWindow(info);
  if (!window) return;
  if (info.rateLimitType === "five_hour") updateStats(id, { fiveHour: window });
  else if (info.rateLimitType === "seven_day") updateStats(id, { sevenDay: window });
}

// The CLI's guess at your next message, for the reply box's placeholder and Tab.
function handleSuggestion(id: string, suggestion: string) {
  const text = suggestion.trim();
  if (text) safeUpdate(id, { suggestion: text });
}

// The agent's reply: its text goes to the thread (status and review blocks lifted onto the card), and
// each tool call gets a thread item its result fills in later.
function handleAssistant(id: string, session: Session, msg: Extract<SDKMessage, { type: "assistant" }>) {
  if (!session.busy) safeUpdate(id, { column: "running" }); // went on after its turn ended: a restart must find it running
  session.busy = true;
  session.cache = cacheAfter(msg.message.usage, Date.now(), session.cache?.ttl) ?? session.cache;
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
      const ask = secretAskOf(block.name, input, session.spec.cwd);
      const index = appendThread(id, { kind: "tool", id: block.id, name: block.name, summary, action, at: Date.now(), ...(ask && { ask }) });
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

// Tool results fill in the tool items the assistant message added. A card that has used vault secrets gets
// each value swapped for ‹NAME› before the result is stored (lib/secret-run.ts); the model saw it as it was.
function handleToolResults(id: string, session: Session, msg: Extract<SDKMessage, { type: "user" }>): void | Promise<void> {
  const content = msg.message.content;
  if (!Array.isArray(content)) return;
  const pending = content.flatMap((b) =>
    b.type === "tool_result" && session.toolIndex.has(b.tool_use_id)
      ? [{ index: session.toolIndex.get(b.tool_use_id) as number, result: liveToolResult(b.content), isError: Boolean(b.is_error) }]
      : [],
  );
  // A screenshot is saved as WebP first, so its result waits for that; text-only results store right away.
  if (pending.every((r) => !(r.result instanceof Promise))) return storeToolResults(id, pending as ToolEntry[]);
  return Promise.all(pending.map(async (r) => ({ ...r, result: await r.result }))).then((results) => storeToolResults(id, results));
}

type ToolEntry = { index: number; result: ToolResult; isError: boolean };

function storeToolResults(id: string, results: ToolEntry[]): void | Promise<void> {
  return withRedacted(id, results.map((r) => r.result.result), (texts) => {
    results.forEach(({ index, result, isError }, i) => {
      const item = getThread(id)[index];
      if (item?.kind === "tool") replaceThreadItem(id, index, { ...item, ...result, result: texts[i] as string, isError });
    });
  });
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

  if (isError && (isNotLoggedInError(summary) || isRateLimitError(summary))) {
    appendThread(id, { kind: "result", text: summary, isError: true, at: Date.now() });
    if (isRateLimitError(summary)) hitRateLimit(id, session.spec.backend, summary);
    else hooks.needLogin(id, session.spec.backend, summary);
    return;
  }

  const status = parsed.status ?? session.status;
  const cost = turnCost(getCard(id)?.costUsd ?? 0, msg.total_cost_usd, session.costBase);
  session.costBase = cost.base;
  appendThread(id, { kind: "result", text: summary, costUsd: cost.costUsd, isError, at: Date.now() });
  safeUpdate(id, {
    sessionId: msg.session_id,
    column: columnAfterTurn(stopped, isError, status),
    pending: null,
    costUsd: cost.costUsd,
    turns: (getCard(id)?.turns ?? 0) + 1,
    lastActivity: Date.now(),
    lastWeftTurn: Date.now(),
    stats: turnStats(id, session, msg.modelUsage),
    lastLine: firstLine(summary) || "Done",
    error: isError ? summary : undefined,
    ...(status ? { stage: status.stage, remaining: status.remaining } : {}),
  });
  scheduleIdle(session);
  if (!session.spec.copilot) showAfter(id, session, { reply: summary, isError, stopped });
  finishResult(id, status, stopped, isError);
}

// The bookkeeping around archiveAfter and the queued-turn handoff.
function finishResult(id: string, status: BoardStatus | undefined, stopped: boolean, isError: boolean) {
  const failed = stopped || isError;
  if (archiveAfter.has(id) && (failed || (!queued.has(id) && status?.column !== "needs_you"))) {
    archiveAfter.delete(id);
    // A stopped or failed wrap-up isn't filed away; a starred card stays on the board too.
    safeUpdate(id, failed ? { wrappingUp: false } : { column: "done", archived: !getCard(id)?.starred, wrappingUp: false });
  }
  // Whether the wrap-up succeeded, failed, or was stopped: the /weft:done turn is over, so the model's
  // and effort's snapshot (if a Done move applied one) is no longer needed. Safe on a card that was
  // moved to Done by a /weft:done the user typed themselves, where there's no snapshot.
  restoreDoneOverride(id);
  if (queued.has(id)) {
    if (failed) queued.delete(id);
    // Once the drive loop has handled this result, so the next turn starts on a settled card.
    else if (status?.column !== "needs_you") setTimeout(() => hooks.sendQueued(id), 0);
  }
  // A message that came mid-turn goes whatever the turn's end: it's yours (or a page's on your click).
  // Queued automations go first when they're running on; it then waits for the last of them.
  if (!queued.has(id)) setTimeout(() => hooks.sendHeld(id), 0);
}

// A teammate's update page for the pane when the turn showed nothing (lib/show.ts), written in the background.
function showAfter(id: string, session: Session, turn: { reply: string; isError: boolean; stopped: boolean }) {
  const ask = getThread(id).findLast((item) => item.kind === "user");
  const seq = session.turnSeq;
  const turnInfo = { ...turn, ask: ask?.kind === "user" ? ask.text : "", openedPane: Boolean(session.openedPane) };
  showAfterTurn(id, turnInfo, () => session.turnSeq === seq && !session.busy).catch(() => {});
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
    ...modelStats(modelUsage, session.cache?.tokens),
    ...(session.cache && { cache: session.cache }),
    ...changedLines(session.spec.cwd),
    branch: gitBranch(session.spec.cwd),
  };
}

// Every function here, for the session fingerprint (BUILD in lib/runner-session.ts): changing any of them
// replaces idle sessions started by the old code.
export const TURN_CODE = [handle, handleRateLimit, handleSuggestion, handleAssistant, recordEdit, handleToolResults, storeToolResults, handleResult, finishResult, showAfter, refreshLimits, updateStats, turnStats];
