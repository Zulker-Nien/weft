import type { Card, ThreadItem } from "./types";

// The copilot's lane on the right of the board (components/CopilotLane.tsx). It has three states, like
// Intercom's hider:
//
//   hidden  — a 36px pill pinned to the right edge (avatar, needs-you dot, count, rotated label).
//             The default. The copilot is there if you need it, but it doesn't eat board width.
//   peek    — the 236px digest column: what needs you, what finished since you last asked, the latest
//             reply, a peek at the cockpit, and an ask box. Reached by hovering the hider, focusing the
//             ask input, the copilot having news, or by clicking the pill.
//   open    — the 520px chat over the cockpit. Reached by ⌘J, the top bar button, or the peek's
//             "Open the cockpit" button.
//
// Widths are exported for the lane and for the board's column min-width floor; the board wants to
// know which state it's in so it can keep its columns readable.
export type LaneState = "hidden" | "peek" | "open";

export const LANE_WIDTH = { hidden: 36, peek: 236, open: 520 } as const;

// ⌘J and the top bar button cycle through the three states in this order.
export const LANE_CYCLE: Record<LaneState, LaneState> = { hidden: "peek", peek: "open", open: "hidden" };

// Resolve the current lane state from the two cookies (lib/board-prefs.ts). `open` wins over `peek`.
export function laneStateFromPrefs(open: boolean, peek: boolean): LaneState {
  return open ? "open" : peek ? "peek" : "hidden";
}

// How narrow a board column may get beside the lane before the board scrolls instead.
// Hidden takes only 36px so columns can stay roomy; peek and open give the chat room and narrow
// the columns to a tighter floor.
export function columnMinWidth(state: LaneState): number {
  return state === "open" || state === "peek" ? 120 : 170;
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

// What the peek shows: what needs you, what finished since you last asked, the latest reply.
export function laneDigest(cards: Card[], items: ThreadItem[]): LaneDigest {
  const since = lastAsked(items);
  const live = cards.filter((c) => !c.archived && c.role !== "copilot");
  return {
    needsYou: live.filter((c) => c.column === "needs_you").sort((a, b) => b.updatedAt - a.updatedAt),
    finished: live.filter((c) => (c.column === "review" || c.column === "done") && c.updatedAt > since).length,
    lastReply: lastReply(items),
  };
}
