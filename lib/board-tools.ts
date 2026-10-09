import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { firstMessage } from "./automations";
import { resolveFolder } from "./folders";
import { clip, formatCost, shortToolName, titleFromPrompt } from "./format";
import { touchProject } from "./settings";
import { createCard, getCard, getThread, listCards, updateCard } from "./store";
import type { Backend, Card, PermissionMode, ThreadItem } from "./types";

// What the board tools need from the runner, passed in to avoid a circular import.
export interface BoardActions {
  start(cardId: string, text: string): void;
  stop(cardId: string): Promise<void>;
  answer(cardId: string, allow: boolean, answers?: Record<string, string>): void;
  isBusy(cardId: string): boolean;
}

export const COPILOT_PROMPT = `You are the Weft copilot: the orchestrator for the user's board of AI coding threads.
Each card on the board is a separate Claude Code or puku-cli thread working in a project folder. Columns: Backlog (not started), Running, Needs you (waiting on a permission answer), Review (turn finished), Done.
Use the mcp__board__* tools to see and run the board: list_cards and read_thread to check on work, create_card to add a thread to Backlog, start_card to run it, send_message to reply to a thread, move_card, stop_card, and answer_permission when the user tells you to approve or deny something.
Delegate real work to threads instead of doing it yourself. Give each new thread a self-contained prompt and the right folder; it knows nothing about this chat.
You're in a small chat window, so keep replies short.`;

// The copilot uses these without asking: they read the board or only rearrange it.
// Starting, replying to, and answering for a thread run agents, so the user approves those.
export const SAFE_BOARD_TOOLS = new Set(["list_cards", "read_thread", "create_card", "move_card", "stop_card"]);

function boardCard(id: string): Card {
  const card = getCard(id);
  if (!card || card.role === "copilot") throw new Error(`No card ${id}. Use list_cards to get card ids.`);
  return card;
}

function describeCard(card: Card) {
  const cost = formatCost(card.costUsd);
  return [
    `id: ${card.id}`,
    `title: ${card.title}`,
    `column: ${card.column}`,
    `cli: ${card.backend}`,
    `folder: ${card.cwd}`,
    card.stage && `stage: ${card.stage}`,
    card.remaining && `remaining: ${card.remaining}`,
    card.lastLine && `latest: ${card.lastLine}`,
    card.pending && `waiting on the user for: ${card.pending.title}`,
    card.error && `error: ${card.error}`,
    cost && `cost: ${cost}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function threadText(items: ThreadItem[]) {
  return items
    .map((item) => {
      switch (item.kind) {
        case "user":
          return `USER: ${item.text}`;
        case "assistant":
          return `AGENT: ${item.text}`;
        case "tool":
          return `TOOL ${shortToolName(item.name)} ${item.summary}${item.isError ? " (failed)" : ""}`;
        case "permission":
          return `PERMISSION ${item.title}: ${item.decision ?? "waiting"}`;
        case "result":
          return item.isError ? `TURN ENDED: ${item.text}` : "TURN FINISHED";
      }
    })
    .join("\n\n");
}

// A readable permission prompt for the board tools that need the user's OK.
export function describeBoardTool(toolName: string, input: Record<string, unknown>): string | null {
  const name = toolName.replace(/^mcp__board__/, "");
  const card = typeof input.card_id === "string" ? getCard(input.card_id) : undefined;
  const label = card ? `“${card.title}”` : String(input.card_id ?? "a card");
  switch (name) {
    case "start_card":
      return `Start ${label}`;
    case "send_message":
      return `Reply to ${label}: ${clip(String(input.text ?? ""), 140)}`;
    case "answer_permission":
      return `${input.allow ? "Allow" : "Deny"} ${card?.pending?.title ?? "its request"} on ${label}`;
    default:
      return null;
  }
}

async function attempt(run: () => string | Promise<string>) {
  try {
    return { content: [{ type: "text" as const, text: await run() }] };
  } catch (err) {
    return { content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }], isError: true };
  }
}

const COLUMN = z.enum(["backlog", "running", "needs_you", "review", "done"]);

interface NewBoardCard {
  prompt: string;
  folder: string;
  title?: string;
  cli?: Backend;
  permissionMode: PermissionMode;
  // The card whose thread asked for this one.
  parentId?: string;
}

// The one place a card is made on behalf of a thread, whether it is the copilot's or a board thread's.
export function createBoardCard(args: NewBoardCard): Card {
  const card = createCard({
    title: args.title?.trim() || titleFromPrompt(args.prompt),
    prompt: args.prompt,
    cwd: resolveFolder(args.folder),
    backend: args.cli ?? "claude",
    permissionMode: args.permissionMode,
    parentId: args.parentId,
  });
  touchProject(card.cwd);
  return card;
}

function listCardsTool() {
  return tool(
    "list_cards",
    "List the threads on the board with their column, folder, CLI, latest activity, and anything waiting on the user.",
    { column: COLUMN.optional() },
    ({ column }) =>
      attempt(() => {
        const cards = listCards().filter((c) => c.role !== "copilot" && (!column || c.column === column));
        return cards.length ? cards.map(describeCard).join("\n\n") : `No cards${column ? ` in ${column}` : ""}.`;
      }),
  );
}

// What every board thread gets: look at the board and hand work off, nothing that touches other cards.
// The card is read when the tool runs, since a spare CLI only gets its card later.
export function threadBoardMcpServer(
  getCardId: () => string | undefined,
  actions: Pick<BoardActions, "start">,
) {
  return createSdkMcpServer({
    name: "board",
    version: "0.1.0",
    alwaysLoad: true,
    tools: [
      listCardsTool(),
      tool(
        "create_card",
        "Hand work to a new thread on the board, started right away unless start is false. Its prompt must be self-contained: the thread knows nothing else. Call list_cards first so you don't duplicate a card that already exists.",
        {
          prompt: z.string(),
          title: z.string().optional(),
          folder: z.string().optional().describe("Project folder; defaults to this thread's own folder"),
          start: z.boolean().optional().describe("Run it now (default true); false leaves it in Backlog"),
        },
        ({ prompt, title, folder, start }) =>
          attempt(() => {
            const parent = getCardId() ? getCard(getCardId()!) : undefined;
            const card = createBoardCard({
              prompt,
              title,
              folder: folder ?? parent?.cwd ?? "",
              // Same trust level as the thread that asked.
              permissionMode: parent?.permissionMode ?? "default",
              parentId: parent?.id,
            });
            if (start === false) return `Created ${card.id} in Backlog: ${card.title}`;
            actions.start(card.id, firstMessage(card));
            return `Created and started ${card.id}: ${card.title}`;
          }),
      ),
    ],
  });
}

// A fresh server per query: an MCP server instance serves one connection.
export function boardMcpServer(actions: BoardActions) {
  return createSdkMcpServer({
    name: "board",
    version: "0.1.0",
    alwaysLoad: true,
    tools: [
      listCardsTool(),
      tool(
        "read_thread",
        "Read a thread's conversation: user messages, agent replies, tool calls, and permission requests.",
        { card_id: z.string(), last: z.number().int().positive().optional().describe("Only the last N entries (default 30)") },
        ({ card_id, last }) =>
          attempt(() => {
            const card = boardCard(card_id);
            const items = getThread(card.id).filter(Boolean).slice(-(last ?? 30));
            return `${describeCard(card)}\n\n---\n\n${threadText(items) || "(empty thread)"}`;
          }),
      ),
      tool(
        "create_card",
        "Add a new thread to Backlog. Its prompt must be self-contained: the thread knows nothing else. It doesn't run until started.",
        {
          prompt: z.string(),
          folder: z.string().describe("Project folder, absolute or ~/..."),
          title: z.string().optional(),
          cli: z.enum(["claude", "puku"]).optional(),
          permission_mode: z.enum(["default", "acceptEdits", "auto", "bypassPermissions"]).optional(),
        },
        (args) =>
          attempt(() => {
            const card = createBoardCard({ ...args, permissionMode: args.permission_mode ?? "default" });
            return `Created ${card.id} in Backlog: ${card.title}`;
          }),
      ),
      tool("start_card", "Start a Backlog card running its prompt.", { card_id: z.string() }, ({ card_id }) =>
        attempt(() => {
          const card = boardCard(card_id);
          if (card.column !== "backlog") {
            throw new Error(`“${card.title}” is in ${card.column}, not Backlog. Use send_message to continue it.`);
          }
          actions.start(card.id, firstMessage(card));
          return `Started “${card.title}”.`;
        }),
      ),
      tool(
        "send_message",
        "Reply to a thread that isn't running. It continues the same session with your message.",
        { card_id: z.string(), text: z.string() },
        ({ card_id, text }) =>
          attempt(() => {
            const card = boardCard(card_id);
            actions.start(card.id, text);
            return `Sent to “${card.title}”.`;
          }),
      ),
      tool(
        "move_card",
        "Move a card to Backlog, Review, or Done. Running and Needs you follow the thread itself. Unlike the user's own moves, this doesn't run the board's automations; to run a skill on a card, send_message it /<skill> (for example /weft:done).",
        { card_id: z.string(), column: z.enum(["backlog", "review", "done"]) },
        ({ card_id, column }) =>
          attempt(() => {
            const card = boardCard(card_id);
            if (actions.isBusy(card.id)) throw new Error(`“${card.title}” is running. Stop it first.`);
            updateCard(card.id, { column });
            return `Moved “${card.title}” to ${column}.`;
          }),
      ),
      tool("stop_card", "Stop a running thread's current turn.", { card_id: z.string() }, ({ card_id }) =>
        attempt(async () => {
          const card = boardCard(card_id);
          await actions.stop(card.id);
          return `Stopped “${card.title}”.`;
        }),
      ),
      tool(
        "answer_permission",
        "Allow or deny the permission request a thread is waiting on, or answer the question it asked (pass answer). Only do this when the user has told you to.",
        { card_id: z.string(), allow: z.boolean(), answer: z.string().optional().describe("Your answer, when the thread asked a question") },
        ({ card_id, allow, answer }) =>
          attempt(() => {
            const card = boardCard(card_id);
            const questions = card.pending?.questions;
            const answers = questions && answer ? Object.fromEntries(questions.map((q) => [q.question, answer])) : undefined;
            actions.answer(card.id, allow, answers);
            return `${allow ? "Allowed" : "Denied"} on “${card.title}”.`;
          }),
      ),
    ],
  });
}
