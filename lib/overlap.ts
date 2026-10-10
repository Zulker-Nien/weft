import type { Card } from "./types";

// Busy-folder warnings: Weft gives cards no git worktree of their own (see SOUL.md), so two cards
// working in one folder share a working tree. These helpers find the other busy cards in a card's
// folder from the board data alone, with no git calls, so they cost nothing on the start-a-card path.

// "/a/b/" -> "/a/b", so trailing slashes don't hide a match.
function trim(cwd: string) {
  return cwd.length > 1 ? cwd.replace(/\/+$/, "") : cwd;
}

// The Claude Code worktree a folder sits in, if any: a separate working tree, so no clash with its repo.
function worktreeOf(cwd: string) {
  return /^.+?\/\.claude\/worktrees\/[^/]+(?=\/|$)/.exec(cwd)?.[0];
}

function inside(child: string, parent: string) {
  return child === parent || child.startsWith(parent === "/" ? "/" : `${parent}/`);
}

// Whether two folders share a working tree: the same folder, or one inside the other, and not split
// apart by a worktree.
export function sameTree(a: string, b: string) {
  const x = trim(a);
  const y = trim(b);
  if (!inside(x, y) && !inside(y, x)) return false;
  return worktreeOf(x) === worktreeOf(y);
}

export function isBusy(card: Card) {
  return (card.column === "running" || card.column === "needs_you") && !card.archived && card.role !== "copilot";
}

// The other busy cards working in this folder (pass the card's id to leave it out).
export function busyInFolder(cards: Card[], cwd: string, exceptId?: string) {
  return cards.filter((c) => c.id !== exceptId && isBusy(c) && sameTree(c.cwd, cwd));
}

// The other busy cards in this card's folder.
export function busyHere(cards: Card[], card: Card) {
  return busyInFolder(cards, card.cwd, card.id);
}

// "Also running here: Fix login" or "Also running here: Fix login and 2 more".
export function alsoHereLine(others: Card[]) {
  if (others.length === 0) return "";
  const more = others.length - 1;
  return `Also running here: ${others[0].title}${more ? ` and ${more} more` : ""}`;
}
