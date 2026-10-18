import type { Card, ThreadItem } from "./types";

// What a cold card's brief is made of (lib/splice-brief.ts): the files its edits touched (with the symbols and
// line counts of each edit) and the prompt Haiku summarizes the thread with.

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
