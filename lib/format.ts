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
