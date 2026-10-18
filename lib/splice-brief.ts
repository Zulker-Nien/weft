import { formatTokens } from "./format";
import { complete } from "./haiku";
import { summaryPrompt, touchedFiles, type TouchedFile } from "./handoff";
import { scopedDiff } from "./splice-diff";
import { getCard, getThread } from "./store";
import type { Card } from "./types";

// The brief a fresh session in the same card starts from (lib/splice.ts): a Haiku summary of the thread, what
// its last BOARD STATUS left open, the files it changed and their diff. Written ahead of time when a card's
// cache is about to lapse (prebakeBrief), so the send that needs it doesn't wait on Haiku.

interface Baked {
  // The cache it was written for (CacheState.at): a turn since then makes it stale.
  cacheAt: number;
  summary: string;
}

const g = globalThis as unknown as { __weftBriefs?: Map<string, Baked>; __weftBaking?: Set<string> };
const baked = (g.__weftBriefs ??= new Map<string, Baked>());
const baking = (g.__weftBaking ??= new Set<string>());

function fileLine(f: TouchedFile): string {
  const counts = f.added || f.removed ? ` (+${f.added}/-${f.removed})` : "";
  return `- ${f.file}${counts}`;
}

// The text that goes ahead of your message in the fresh session's first turn.
export function briefText(card: Card, summary: string, files: TouchedFile[], diff: string): string {
  const tokens = card.stats?.cache?.tokens;
  const lines = [
    `<system-reminder>`,
    `This card's prompt cache had gone cold, so Weft started a fresh session in it instead of re-sending the whole thread${tokens ? ` (${formatTokens(tokens)} tokens)` : ""}. What came before, in short:`,
    "",
    summary.trim(),
  ];
  if (card.remaining && card.remaining !== "none") lines.push("", `Still open, from its last status line: ${card.remaining}`);
  if (files.length) {
    lines.push("", "Files it changed (other cards may have uncommitted edits in the same files; this diff keeps the hunks this thread's edits touched):", ...files.map(fileLine));
  }
  if (diff) lines.push("", "```diff", diff, "```");
  lines.push("</system-reminder>", "", "");
  return lines.join("\n");
}

async function summarize(card: Card): Promise<string> {
  try {
    const summary = await complete(summaryPrompt(card, getThread(card.id)));
    if (summary.trim()) return summary;
  } catch {
    // Fall through to the card's own last words.
  }
  return card.lastLine ?? "(no summary available; read the files below)";
}

// Writes the summary for the card's current cache, once; a later call for the same cache is a no-op.
export async function prebakeBrief(cardId: string): Promise<void> {
  const card = getCard(cardId);
  const cacheAt = card?.stats?.cache?.at;
  if (!card || cacheAt === undefined || baked.get(cardId)?.cacheAt === cacheAt || baking.has(cardId)) return;
  baking.add(cardId);
  try {
    baked.set(cardId, { cacheAt, summary: await summarize(card) });
  } finally {
    baking.delete(cardId);
  }
}

// The brief for a fresh session now: the pre-baked summary when it's for this cache, else a new one. The diff is
// always read now, since files can change after the summary was written.
export async function briefFor(card: Card): Promise<string> {
  const ready = baked.get(card.id);
  const summary = ready && ready.cacheAt === card.stats?.cache?.at ? ready.summary : await summarize(card);
  baked.delete(card.id);
  const files = touchedFiles(getThread(card.id));
  return briefText(card, summary, files, scopedDiff(card.cwd, files));
}

// For tests.
export function bakedSummary(cardId: string): string | undefined {
  return baked.get(cardId)?.summary;
}
