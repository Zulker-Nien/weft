import { complete } from "./haiku";
import { createCardFromBody, startCard } from "./new-card";
import { getCard, getThread } from "./store";
import type { Card, ThreadItem } from "./types";

// "Continue in new card": a card whose prompt cache has gone cold re-sends its whole thread at full price
// on the next message. This carries the work into a fresh card instead: a Haiku summary of the thread,
// the files it touched (and the symbols and line counts of each edit), and the message you had typed.

const EDIT_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);

// The longest transcript sent to Haiku; the newest part is kept, since that is where the work stands.
const TRANSCRIPT_CAP = 24_000;

export interface TouchedFile {
  file: string;
  edits: number;
  added: number;
  removed: number;
  symbols: string[];
}

// Every file the thread's Edit/Write calls changed, once each, in the order first touched.
export function touchedFiles(items: ThreadItem[]): TouchedFile[] {
  const files = new Map<string, TouchedFile>();
  for (const item of items) {
    if (item.kind !== "tool" || !EDIT_TOOLS.has(item.name) || !item.file) continue;
    const seen = files.get(item.file) ?? { file: item.file, edits: 0, added: 0, removed: 0, symbols: [] };
    seen.edits += 1;
    seen.added += item.edit?.added ?? 0;
    seen.removed += item.edit?.removed ?? 0;
    for (const s of item.edit?.symbols ?? []) if (!seen.symbols.includes(s)) seen.symbols.push(s);
    files.set(item.file, seen);
  }
  return [...files.values()];
}

// The thread as plain text for the summarizer: what you asked, what the agent said, which tools it ran.
export function transcript(items: ThreadItem[]): string {
  const lines: string[] = [];
  for (const item of items) {
    if (item.kind === "user") lines.push(`USER: ${item.text}`);
    else if (item.kind === "assistant") lines.push(`ASSISTANT: ${item.text}`);
    else if (item.kind === "tool") lines.push(`TOOL ${item.name}: ${item.summary}`);
  }
  const text = lines.join("\n");
  return text.length > TRANSCRIPT_CAP ? `…${text.slice(-TRANSCRIPT_CAP)}` : text;
}

export function summaryPrompt(card: Card, items: ThreadItem[]): string {
  return [
    `Summarize this coding thread ("${card.title}") so a fresh agent can pick the work up without reading it.`,
    "Cover: the goal, what was decided, what is done, what is still open or broken, and anything the next agent must not redo.",
    "Plain Markdown, under 300 words, no preamble.",
    "",
    transcript(items),
  ].join("\n");
}

function fileLine(f: TouchedFile): string {
  const counts = f.added || f.removed ? ` (+${f.added}/-${f.removed})` : "";
  const symbols = f.symbols.length ? `, ${f.symbols.join(", ")}` : "";
  return `- ${f.file}${counts}${symbols}`;
}

// The new card's first message: where the old card left off, then what you wanted to say next.
export function handoffPrompt(card: Card, summary: string, files: TouchedFile[], message: string): string {
  const list = files.length ? files.map(fileLine).join("\n") : "- none edited yet";
  return [
    `Continuing from the card "${card.title}", whose prompt cache had gone cold. Its summary:`,
    "",
    summary.trim(),
    "",
    "Files it touched (read them before editing; they hold the work so far):",
    list,
    "",
    message.trim() ? `Next:\n${message.trim()}` : "Pick up where it left off.",
  ].join("\n");
}

// Summarizes the card and starts a new one in its folder with the same CLI, model and mode. If the
// summarizer fails, the new card still starts, with the card's own last words instead of a summary.
export async function continueInNewCard(id: string, message: string): Promise<Card> {
  const card = getCard(id);
  if (!card) throw new Error("No such card.");
  const items = getThread(id);
  let summary = "";
  try {
    summary = await complete(summaryPrompt(card, items));
  } catch {
    summary = "";
  }
  if (!summary.trim()) summary = card.lastLine ?? "(no summary available; read the files below)";
  const next = createCardFromBody({
    prompt: handoffPrompt(card, summary, touchedFiles(items), message),
    title: `${card.title} (continued)`,
    cwd: card.cwd,
    backend: card.backend,
    permissionMode: card.permissionMode,
    model: card.model,
    effort: card.effort,
    tags: card.tags,
  });
  startCard(next);
  return next;
}
