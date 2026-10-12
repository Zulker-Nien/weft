import { titleFromPrompt } from "./format";
import { normalizeTag, normalizeTags, tagCounts } from "./tags";
import type { Card } from "./types";

// Naming cards: a card whose title says nothing ("Image attachment", "Untitled thread", or just its
// prompt's first line) gets a short Haiku title with an emoji after its first turn, like
// "🐞 Compile Error: missing CoverageBadge import". A title you typed is never touched. A card with no
// tags gets one to three in the same call (lib/tags.ts), picked from the board's own tags when one fits.

const MAX_TITLE = 60;
const MAX_ASK_CHARS = 600;
const MAX_REPLY_CHARS = 1_500;

// How many tags Haiku picks, how many of the board's it's shown, and the kinds and areas a new board starts from.
const ASK_TAGS = 3;
const MAX_VOCABULARY = 30;
export const STARTER_TAGS = ["bug", "feature", "ui", "refactor", "tests", "docs", "release", "research", "setup", "perf"];

// Titles that name the attachment or the lack of a name, not the work (Claude Code's own summaries
// for a pasted screenshot, and the board's fallbacks).
const PLACEHOLDER = /^(\[?image #?\d*\]?|(image|screenshot|file|photo|pasted[- ]image)( attachment)?s?|untitled( thread)?|new thread|look at .*)$/i;

// The emoji at the start of a title, if any.
const LEADING_EMOJI = /^\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*/u;

// A "Tags:" line, label markdown and all ("**Tags:** bug, ui"); group 1 is what follows it.
const TAGS_LINE = /^[\s*_#>-]*tags?[\s*_]*:[\s*_]*(.*)$/i;
// A list bullet or number at the start of a line.
const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+/;
// What a tag Haiku picked may look like: words, not a sentence, markup or a label.
const PLAIN_TAG = /^[\p{L}\p{N}][\p{L}\p{N} &+./_-]*$/u;

// Whether this card should get an automatic title: nobody named it, and its title is empty, a
// placeholder, or only its prompt's first line.
export function shouldRetitle(card: Pick<Card, "title" | "prompt" | "titleBy" | "role">) {
  if (card.titleBy || card.role === "copilot") return false;
  const title = card.title.trim();
  return !title || PLACEHOLDER.test(title) || title === titleFromPrompt(card.prompt);
}

// Whether this card should get automatic tags: it has none, and you haven't set (or cleared) them yourself.
export function shouldTag(card: Pick<Card, "tags" | "tagsBy" | "role">) {
  return card.role !== "copilot" && card.tagsBy !== "user" && !card.tags?.length;
}

export type NameNeeds = { title: boolean; tags: boolean };

// What a card still needs after a turn; neither means no Haiku call.
export function nameNeeds(card: Pick<Card, "title" | "prompt" | "titleBy" | "role" | "tags" | "tagsBy">): NameNeeds {
  return { title: shouldRetitle(card), tags: shouldTag(card) };
}

// The board's tags Haiku should reuse: the tag catalog's names first, then the cards' tags, most used first.
export function tagVocabulary(cards: readonly Pick<Card, "tags">[], catalog: readonly string[] = []) {
  const names = [...catalog, ...tagCounts(cards).map((t) => t.tag)].map(normalizeTag).filter((t) => t !== undefined);
  return [...new Set(names)].slice(0, MAX_VOCABULARY);
}

const TITLE_RULE = `in at most 8 words, as one emoji, a space, then a specific title (a kind of "Compile Error: missing CoverageBadge import" or "Add dark mode toggle"). Say what the work is, not that a file or screenshot was attached.`;

function tagRule(vocabulary: readonly string[]) {
  const known = vocabulary.slice(0, MAX_VOCABULARY);
  const pick = known.length
    ? `This board already uses: ${known.join(", ")}. Reuse those whenever one fits; add a new tag only when none does.`
    : `Prefer one kind of work and one area, such as ${STARTER_TAGS.join(", ")}.`;
  return `with 1 to ${String(ASK_TAGS)} short lowercase tags, a word or two each, like GitHub issue labels. ${pick}`;
}

function turnText(ask: string, reply: string) {
  return `The user asked: ${JSON.stringify(ask.slice(0, MAX_ASK_CHARS))}
The agent replied:
${reply.slice(0, MAX_REPLY_CHARS)}`;
}

export function titlePrompt(ask: string, reply: string) {
  return `Name this coding thread ${TITLE_RULE} Reply with only the title.

${turnText(ask, reply)}`;
}

export function tagPrompt(ask: string, reply: string, vocabulary: readonly string[] = []) {
  return `Tag this coding thread ${tagRule(vocabulary)} Reply with only one line: "Tags: " then the tags, comma-separated.

${turnText(ask, reply)}`;
}

// One Haiku prompt for whatever the card needs: today's title prompt, the tag prompt, or both in two lines.
export function namePrompt(needs: NameNeeds, ask: string, reply: string, vocabulary: readonly string[] = []) {
  if (!needs.tags) return titlePrompt(ask, reply);
  if (!needs.title) return tagPrompt(ask, reply, vocabulary);
  return `Name this coding thread ${TITLE_RULE} Then tag it ${tagRule(vocabulary)} Reply with exactly two lines:
Title: <emoji> <title>
Tags: <tag>, <tag>

${turnText(ask, reply)}`;
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

// The tags from Haiku's reply: its "Tags:" line (and a bulleted list under an empty one), or with
// `unlabelled` and no such line, the whole reply. Split on commas, stripped of quotes and bullets,
// normalized, plain words only, at most three. Empty when nothing usable came back.
export function parseTags(reply: string, unlabelled = true): string[] {
  const lines = reply.split("\n");
  const at = lines.findIndex((l) => TAGS_LINE.test(l));
  const raw = at < 0 ? (unlabelled ? lines : []) : [...lines.slice(at, at + 1).map((l) => l.replace(TAGS_LINE, "$1")), ...bulletsAfter(lines, at)];
  const pieces = raw
    .flatMap((l) => l.split(/[,;]/))
    .map((p) => p.replace(BULLET, "").replace(/^["'`“”*_\s]+|["'`“”*_.\s]+$/g, ""));
  return normalizeTags(pieces)
    .filter((t) => PLAIN_TAG.test(t) && t.split(" ").length <= 3)
    .slice(0, ASK_TAGS);
}

function bulletsAfter(lines: string[], at: number) {
  const rest = lines.slice(at + 1);
  const end = rest.findIndex((l) => !BULLET.test(l));
  return end < 0 ? rest : rest.slice(0, end);
}

// Both halves of a reply to namePrompt. Unlabelled lines count as tags only when tags were all it asked
// for; a title-and-tags reply without a "Tags:" line is read as a title alone.
export function parseName(reply: string, needs: NameNeeds): { title?: string; tags: string[] } {
  const title = needs.title ? parseTitle(reply.split("\n").filter((l) => !TAGS_LINE.test(l)).join("\n")) : undefined;
  return { title, tags: needs.tags ? parseTags(reply, !needs.title) : [] };
}

// The emoji a title starts with, for the card's tile.
export function titleEmoji(title: string) {
  return LEADING_EMOJI.exec(title)?.[0];
}
