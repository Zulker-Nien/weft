import type { Card, ThreadItem } from "./types";

// The copilot's lane on the right of the board (components/CopilotLane.tsx). Minimized it's a column of
// its own; open it's the chat, wide enough to talk in while the five columns stay readable beside it.
export const LANE_WIDTH = { minimized: 236, open: 520 } as const;

// How narrow a board column may get beside the lane before the board scrolls instead.
export function columnMinWidth(laneOpen: boolean): number {
  return laneOpen ? 120 : 170;
}

// The copilot's picture: the hovercaddy cockpit from the driver's seat, the copilot beside you.
// `face` is where the copilot's face sits in it, for the avatar crop.
export const COCKPIT = { src: "/copilots/wingman.jpg", face: "90% 36%" } as const;

export interface LaneDigest {
  // Cards waiting on you, newest first.
  needsYou: Card[];
  // Cards that reached Review or Done since you last asked the copilot something.
  finished: number;
  // The copilot's latest reply, flattened to one line, or null before it said anything.
  lastReply: string | null;
}

// When you last asked the copilot something: the time of the last message you sent it.
export function lastAsked(items: ThreadItem[]): number {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item?.kind === "user") return item.at;
  }
  return 0;
}

// The copilot's latest reply as one plain line: Markdown marks and status lines (BOARD STATUS, a
// "=-=[ SESSION STATUS" line some CLAUDE.md files ask for) dropped.
export function lastReply(items: ThreadItem[], max = 220): string | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item?.kind !== "assistant" || !item.text.trim()) continue;
    const text = item.text
      .split("\n")
      .filter((line) => !/^\s*(BOARD STATUS:|`?=-=\[)/.test(line) && !/^\s*```/.test(line))
      .join(" ")
      .replace(/[*_`#>]+/g, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) continue;
    return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
  }
  return null;
}

// What the minimized lane shows: what needs you, what finished since you last asked, the latest reply.
export function laneDigest(cards: Card[], items: ThreadItem[]): LaneDigest {
  const since = lastAsked(items);
  const live = cards.filter((c) => !c.archived && c.role !== "copilot");
  return {
    needsYou: live.filter((c) => c.column === "needs_you").sort((a, b) => b.updatedAt - a.updatedAt),
    finished: live.filter((c) => (c.column === "review" || c.column === "done") && c.updatedAt > since).length,
    lastReply: lastReply(items),
  };
}
