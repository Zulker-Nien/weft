import { titleFromPrompt } from "./format";
import type { Card } from "./types";

// Renaming cards: a card whose title says nothing ("Image attachment", "Untitled thread", or just its
// prompt's first line) gets a short Haiku title with an emoji after its first turn, like
// "🐞 Compile Error: missing CoverageBadge import". A title you typed is never touched.

const MAX_TITLE = 60;
const MAX_ASK_CHARS = 600;
const MAX_REPLY_CHARS = 1_500;

// Titles that name the attachment or the lack of a name, not the work (Claude Code's own summaries
// for a pasted screenshot, and the board's fallbacks).
const PLACEHOLDER = /^(\[?image #?\d*\]?|(image|screenshot|file|photo|pasted[- ]image)( attachment)?s?|untitled( thread)?|new thread|look at .*)$/i;

// The emoji at the start of a title, if any.
const LEADING_EMOJI = /^\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*/u;

// Whether this card should get an automatic title: nobody named it, and its title is empty, a
// placeholder, or only its prompt's first line.
export function shouldRetitle(card: Pick<Card, "title" | "prompt" | "titleBy" | "role">) {
  if (card.titleBy || card.role === "copilot") return false;
  const title = card.title.trim();
  return !title || PLACEHOLDER.test(title) || title === titleFromPrompt(card.prompt);
}

export function titlePrompt(ask: string, reply: string) {
  return `Name this coding thread in at most 8 words, as one emoji, a space, then a specific title (a kind of "Compile Error: missing CoverageBadge import" or "Add dark mode toggle"). Say what the work is, not that a file or screenshot was attached. Reply with only the title.

The user asked: ${JSON.stringify(ask.slice(0, MAX_ASK_CHARS))}
The agent replied:
${reply.slice(0, MAX_REPLY_CHARS)}`;
}

// The card title from Haiku's reply: its first line, without quotes or a "Title:" label, cut to a
// readable length. Undefined when nothing usable came back.
export function parseTitle(reply: string) {
  const line = reply
    .split("\n")
    .map((l) => l.replace(/^\s*(title\s*:\s*)/i, "").replace(/^["'`“”*_#\s]+|["'`“”*_.\s]+$/g, ""))
    .find(Boolean);
  if (!line) return undefined;
  return line.length > MAX_TITLE ? `${line.slice(0, MAX_TITLE - 1).trimEnd()}…` : line;
}

// The emoji a title starts with, for the card's tile.
export function titleEmoji(title: string) {
  return LEADING_EMOJI.exec(title)?.[0];
}
