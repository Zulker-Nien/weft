import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import type { EventEmitter } from "node:events";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { spawnCli } from "./cli-process";
import { CODEX_INPUT_CODE, codexInput, writeImages } from "./codex-input";
import { permissionArgs } from "./codex-permissions";
import { CODEX_DEFAULT_MODEL } from "./new-thread";
import { cliEnv } from "./env";
import { subagentModel, threadPrompt } from "./settings";
import { subagentPrompt } from "./subagents";
import { PLUGIN_DIR } from "./skills";
import { handle } from "./runner-turn";
import { getCard, getThread, replaceThreadItem, updateCard } from "./store";
import { touchFile } from "./overlap";
import type { Session } from "./runner-state";

type CodexItem = {
  id?: string;
  type?: string;
  text?: string;
  command?: string;
  aggregated_output?: string;
  exit_code?: number;
  status?: string;
  changes?: { path?: string }[];
};

type CodexEvent = {
  type?: string;
  thread_id?: string;
  item?: CodexItem;
  usage?: { input_tokens?: number; output_tokens?: number; cached_input_tokens?: number; cache_write_input_tokens?: number };
  error?: { message?: string };
};

interface CliEvents extends EventEmitter {
  once(event: "close", listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  once(event: "error", listener: (error: Error) => void): this;
}

function sdkMessage(message: unknown) {
  return message as SDKMessage;
}

async function assistant(session: Session, text: string) {
  const model = session.spec.model === CODEX_DEFAULT_MODEL ? "Codex" : session.spec.model ?? "Codex";
  await handle(session.cardId as string, session, sdkMessage({
    type: "assistant",
    parent_tool_use_id: null,
    message: {
      id: `codex-${Date.now()}`,
      type: "message",
      role: "assistant",
      model,
      content: [{ type: "text", text }],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    },
  }));
}

async function toolStart(session: Session, item: CodexItem) {
  if (!item.id || session.toolIndex.has(item.id)) return;
  await handle(session.cardId as string, session, sdkMessage({
    type: "assistant",
    parent_tool_use_id: null,
    message: {
      id: `codex-${item.id}`,
      type: "message",
      role: "assistant",
      model: session.spec.model ?? "Codex",
      content: [{ type: "tool_use", id: item.id, name: "Bash", input: { command: item.command ?? "Codex command" } }],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    },
  }));
}

async function toolFinish(session: Session, item: CodexItem) {
  const id = item.id;
  if (!id) return;
  await toolStart(session, item);
  const index = session.toolIndex.get(id);
  if (index === undefined) return;
  const threadItem = getThread(session.cardId as string)[index];
  if (threadItem?.kind !== "tool") return;
  const output = item.aggregated_output?.trim();
  replaceThreadItem(session.cardId as string, index, {
    ...threadItem,
    result: output || (item.exit_code === undefined ? "" : `Exited with code ${item.exit_code}.`),
    isError: item.status === "failed" || (item.exit_code !== undefined && item.exit_code !== 0),
  });
}

function noteFileChanges(session: Session, item: CodexItem) {
  const id = session.cardId;
  if (!id) return;
  for (const change of item.changes ?? []) {
    if (!change.path) continue;
    const card = getCard(id);
    const touched = touchFile(card?.touchedFiles, path.resolve(session.spec.cwd, change.path));
    if (touched) updateCard(id, { touchedFiles: touched });
  }
}

async function result(session: Session, event: CodexEvent, error?: string) {
  const id = session.cardId;
  if (!id) return;
  const usage = event.usage ?? {};
  const model = session.spec.model && session.spec.model !== CODEX_DEFAULT_MODEL ? session.spec.model : "Codex";
  const modelUsage = {
    [model]: {
      inputTokens: usage.input_tokens ?? 0,
      outputTokens: usage.output_tokens ?? 0,
      cacheReadInputTokens: usage.cached_input_tokens ?? 0,
      cacheCreationInputTokens: usage.cache_write_input_tokens ?? 0,
      webSearchRequests: 0,
      costUSD: 0,
      contextWindow: 0,
      maxOutputTokens: 0,
    },
  };
  await handle(id, session, sdkMessage({
    type: "result",
    subtype: error ? "error_execution" : "success",
    is_error: Boolean(error),
    result: error ?? "Done.",
    session_id: session.sessionId ?? session.spec.sessionId ?? "",
    total_cost_usd: 0,
    modelUsage,
  }));
}

function skillPrompt(text: string) {
  const match = /^\/(?:weft:)?([\w.-]+)(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!match) return text;
  const name = match[1] ?? "";
  const args = match[2] ?? "";
  const directory = path.join(PLUGIN_DIR, "skills", name);
  const file = path.join(directory, "SKILL.md");
  try {
    const contents = fs.readFileSync(file, "utf8").replace(/^---\r?\n[\s\S]*?\r?\n---\s*/, "");
    return `Follow this Weft skill for the current turn. Skill files are unavailable as Codex slash commands, so use these instructions directly.\n\n${contents.replaceAll("${CLAUDE_SKILL_DIR}", directory).replaceAll("${ARGUMENTS}", args)}`;
  } catch {
    return text;
  }
}

function promptFor(session: Session, text: string) {
  const weftInstructions = `You are a Codex CLI thread managed by Weft. Work in the card's project folder using Codex's native tools. Weft-specific MCP tools are unavailable in this backend; do not claim to use the board, browser, secrets or webhook tools. Never read .env files, credential stores or environment dumps. Never restart or kill Weft. Codex's sandbox enforces this card's permission mode.\n\n${subagentPrompt(subagentModel(), "codex")}\n\n${threadPrompt()}`;
  return `${weftInstructions}\n\n${skillPrompt(text)}`;
}

function modelArgs(model: string | undefined) {
  return model && model !== CODEX_DEFAULT_MODEL ? ["--model", model] : [];
}

function imageArgs(images: string[]) {
  return images.flatMap((image) => ["--image", image]);
}

function argsFor(session: Session, images: string[]) {
  const card = session.cardId ? getCard(session.cardId) : undefined;
  const model = card?.model ?? session.spec.model;
  const sessionId = session.sessionId ?? session.spec.sessionId;
  if (sessionId) {
    // `exec resume` keeps the saved sandbox and reasoning effort; it only accepts a model override.
    return ["exec", "resume", "--json", ...modelArgs(model), ...imageArgs(images), sessionId, "-"];
  }

  const args = ["exec", "--json", "--cd", session.spec.cwd, "--skip-git-repo-check", ...modelArgs(model), ...imageArgs(images)];
  const effort = card?.effort ?? session.spec.effort;
  if (effort) args.push("--config", `model_reasoning_effort=${JSON.stringify(effort)}`);
  return [...args, ...permissionArgs(card?.permissionMode ?? session.spec.permissionMode), "-"];
}

async function handleItemEvent(session: Session, event: CodexEvent) {
  const item = event.item;
  if (!item) return;
  if (item.type === "command_execution") {
    if (event.type === "item.started") await toolStart(session, item);
    else if (event.type === "item.completed") await toolFinish(session, item);
    return;
  }
  if (event.type !== "item.completed") return;
  if (item.type === "file_change") noteFileChanges(session, item);
  else if (item.type === "agent_message" && item.text) await assistant(session, item.text);
}

async function handleEvent(session: Session, event: CodexEvent) {
  if (event.type === "thread.started") {
    if (!event.thread_id) return false;
    session.sessionId = event.thread_id;
    if (session.cardId) updateCard(session.cardId, { sessionId: event.thread_id });
    return false;
  }

  if (event.type === "item.started" || event.type === "item.updated" || event.type === "item.completed") {
    await handleItemEvent(session, event);
    return false;
  }

  if (event.type === "turn.completed") {
    await result(session, event);
    return true;
  }
  if (event.type === "turn.failed") {
    await result(session, event, event.error?.message ?? "Codex turn failed.");
    return true;
  }
  return false;
}

async function readEvents(session: Session, stdout: NodeJS.ReadableStream) {
  let completed = false;
  const lines = readline.createInterface({ input: stdout, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    let event: CodexEvent;
    try {
      event = JSON.parse(line) as CodexEvent;
    } catch {
      continue;
    }
    if (await handleEvent(session, event)) completed = true;
  }
  lines.close();
  return completed;
}

function assertTurnCompleted(
  completed: boolean,
  aborted: boolean,
  stderrTail: () => string,
  exit: { code: number | null; signal: NodeJS.Signals | null },
) {
  if (completed || aborted) return;
  const tail = stderrTail();
  throw new Error(tail || `Codex exited ${exit.signal ? `on ${exit.signal}` : `with code ${exit.code ?? "unknown"}`} without finishing the turn.`);
}

export async function driveCodex(session: Session, executable: string) {
  for await (const message of session.inbox) {
    if (session.abort.signal.aborted) break;
    const input = codexInput(message);
    const attachments = writeImages(input.images);
    const env = cliEnv();
    delete env.CLAUDE_CODE_ENTRYPOINT;
    const stderr = (data: string) => console.error(`[thread ${(session.cardId ?? "spare").slice(0, 8)}] ${data.trimEnd()}`);
    session.toolIndex.clear();
    try {
      const process = spawnCli({ command: executable, args: argsFor(session, attachments.paths), cwd: session.spec.cwd, env, signal: session.abort.signal }, stderr);
      session.process = process;
      process.stdin.on("error", () => {});
      process.stdin.end(promptFor(session, input.text));
      const proc = process as unknown as CliEvents;
      let spawnError: Error | undefined;
      proc.once("error", (error) => { spawnError = error; });
      const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
        proc.once("close", (code, signal) => resolve({ code, signal }));
      });
      const completed = await readEvents(session, process.stdout);
      const exit = await exited;
      if (spawnError) throw spawnError;
      assertTurnCompleted(completed, session.abort.signal.aborted, () => process.stderrTail(), exit);
    } finally {
      if (attachments.directory) fs.rmSync(attachments.directory, { recursive: true, force: true });
    }
  }
}

export const CODEX_CODE = [
  driveCodex, assistant, toolStart, toolFinish, noteFileChanges, result, skillPrompt, promptFor, permissionArgs,
  modelArgs, imageArgs, argsFor, ...CODEX_INPUT_CODE, handleItemEvent, handleEvent, readEvents, assertTurnCompleted,
];
