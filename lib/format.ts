import type { Card } from "./types";

// Display helpers shared by the server and the board UI.

// A thread is live while a turn runs or a permission request waits; a card in Needs you
// with a question (not a permission request) can be replied to and moved like any other.
export function isLive(card: Card) {
  return card.column === "running" || Boolean(card.pending);
}

export function shortToolName(name: string) {
  return name.startsWith("mcp__") ? name.split("__").slice(1).join(" ") : name;
}

export function folderName(cwd: string) {
  return cwd.split("/").filter(Boolean).pop() ?? cwd;
}

export function formatCost(usd?: number) {
  if (!usd) return null;
  return usd < 0.01 ? "<$0.01" : `$${usd.toFixed(2)}`;
}

export function timeAgo(at: number, now: number) {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

// A card title from its prompt: the first line with words in it, without Markdown markup or pasted
// media. A prompt that's only media is named after its first file.
export function titleFromPrompt(prompt: string, max = 60) {
  const clean = (line: string) =>
    line
      .replace(/!\[([^\]\n]*)\]\([^)\n]*\)/g, "")
      .replace(/\[([^\]\n]*)\]\([^)\n]*\)/g, "$1")
      .replace(/^\s*(#{1,6}\s+|>\s*|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)/, "")
      .replace(/(\*\*|__|~~|`)/g, "")
      .replace(/(^|\s)[*_](\S)/g, "$1$2")
      .replace(/(\S)[*_](?=\s|$)/g, "$1")
      .trim();
  const line = prompt
    .split("\n")
    .filter((l) => !/^\s*(```|~~~|---+\s*$)/.test(l))
    .map(clean)
    .find(Boolean);
  if (line) return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
  const media = /!\[([^\]\n]*)\]/.exec(prompt)?.[1]?.trim();
  return media ? `Look at ${media}` : "New thread";
}
