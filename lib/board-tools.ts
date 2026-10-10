import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { firstMessage } from "./automations";
import { getItem, listLibrary } from "./library";
import { blanksIn } from "./library-view";
import { markSeen } from "./copilot-digest";
import { resolveFolder } from "./folders";
import { clip, firstLine, shortToolName, titleFromPrompt } from "./format";
import { defaultPermissionMode, touchProject } from "./settings";
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
The user's library (list_library) keeps cards they starred: recipes (prompts they run again, with {blanks}), to-dos and notes. When they ask for something like before ("a media kit like last time"), look for a recipe, fill its blanks in the prompt, and pass its recipe_id to create_card.
You're in a small chat window, so keep replies short.`;

// The copilot uses these without asking: they read the board or only rearrange it.
// Starting, replying to, and answering for a thread run agents, so the user approves those.
export const SAFE_BOARD_TOOLS = new Set(["list_cards", "read_thread", "list_library", "create_card", "move_card", "stop_card"]);

// This app's own tools (the browser pane, and the board tools: list_cards, create_card, and the copilot's others) skip the prompt.
// source is the MCP server's type; only in-process ("sdk") servers are Weft's own.
export function isTrustedTool(toolName: string, source?: string) {
  if (source !== "sdk") return false;
  if (toolName.startsWith("mcp__browser__")) return true;
  return toolName.startsWith("mcp__board__") && SAFE_BOARD_TOOLS.has(toolName.slice("mcp__board__".length));
}

function boardCard(id: string): Card {
  const card = getCard(id);
  if (!card || card.role === "copilot") throw new Error(`No card ${id}. Use list_cards to get card ids.`);
  return card;
}

function describeCard(card: Card) {
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
  // The library recipe it runs (lib/library.ts).
  recipeId?: string;
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
    ...(args.recipeId ? { recipeId: args.recipeId } : {}),
  });
  touchProject(card.cwd);
  return card;
}

// The library: recipes with their prompts and blanks, so the copilot can run one; to-dos and notes by title.
function listLibraryTool() {
  return tool(
    "list_library",
    "List the user's library: recipes (prompts they run again, with {blanks} to fill), to-dos (steps for them, with how many are ticked) and notes. Recipes include their prompt.",
    { folder: z.string().optional().describe("Only this project's and the user's own; left out, every project's") },
    ({ folder }) =>
      attempt(() => {
        const items = listLibrary(folder ? { folder: resolveFolder(folder) } : { all: true });
        if (!items.length) return "The library is empty.";
        return items
          .map((i) =>
            [
              `id: ${i.id}`,
              `${i.kind}: ${i.title}`,
              `scope: ${i.scope === "mine" ? "mine (every project)" : i.folder}`,
              i.kind === "recipe" && `folder: ${i.folder}`,
              i.kind === "recipe" && i.blanks?.length && `blanks: ${i.blanks.map((b) => `{${b.name}}${b.hint ? ` (${b.hint})` : ""}`).join(", ")}`,
              i.kind === "recipe" && `prompt: ${i.prompt}`,
              i.kind === "todo" && i.steps && `ticked: ${i.ticked?.length ?? 0} of ${i.steps}`,
            ]
              .filter(Boolean)
              .join("\n"),
          )
          .join("\n\n");
      }),
  );
}

// One line per card, so a whole board fits in a tool result (the full detail is read_thread's).
export function cardLine(card: Card) {
  return [
    card.id,
    card.column,
    clip(card.title, 80),
    card.cwd.replace(/^\/Users\/[^/]+/, "~"),
    card.stage,
    card.remaining && `remaining: ${clip(card.remaining, 60)}`,
    card.pending && `waiting on: ${clip(card.pending.title, 60)}`,
    card.error && `error: ${firstLine(card.error, 60)}`,
    card.lastLine && `latest: ${firstLine(card.lastLine, 80)}`,
  ]
    .filter(Boolean)
    .join(" | ");
}

const LIST_LIMIT = 40;

function listCardsTool() {
  return tool(
    "list_cards",
    "List the threads on the board, one line each: id | column | title | folder | stage | remaining | waiting on | latest. Open cards only unless include_done is true (then done and archived ones too); newest first, up to limit (default 40).",
    {
      column: COLUMN.optional(),
      include_done: z.boolean().optional().describe("Also list done and archived cards (default false)"),
      limit: z.number().int().positive().optional().describe(`Most cards to list (default ${LIST_LIMIT})`),
    },
    ({ column, include_done = false, limit = LIST_LIMIT }) =>
      attempt(() => {
        const all = listCards().filter((c) => c.role !== "copilot" && (!column || c.column === column));
        const cards = all
          .filter((c) => include_done || (c.column !== "done" && !c.archived))
          .sort((a, b) => b.updatedAt - a.updatedAt);
        const hidden = all.length - cards.length;
        const notes = [
          cards.length > limit && `${cards.length - limit} more not shown; raise limit or pass column.`,
          hidden > 0 && `${hidden} done or archived left out; pass include_done=true to list them.`,
        ].filter(Boolean);
        if (!cards.length) notes.unshift(`No ${hidden ? "open " : ""}cards${column ? ` in ${column}` : ""}.`);
        return [...cards.slice(0, limit).map(cardLine), ...notes].join("\n");
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
      listLibraryTool(),
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
          recipe_id: z.string().optional().describe("The library recipe this runs (from list_library), with its {blanks} filled in the prompt"),
        },
        ({ recipe_id, ...args }) =>
          attempt(() => {
            const recipe = recipe_id ? getItem(recipe_id) : undefined;
            if (recipe_id && recipe?.kind !== "recipe") throw new Error(`No recipe ${recipe_id}. Use list_library to get recipe ids.`);
            const left = recipe ? blanksIn(args.prompt) : [];
            if (left.length) throw new Error(`Fill in ${left.map((b) => `{${b}}`).join(", ")} in the prompt first.`);
            const card = createBoardCard({ ...args, permissionMode: args.permission_mode ?? defaultPermissionMode(), recipeId: recipe?.id });
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
            markSeen(card.id, column);
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
