// How archiving reads and where keyboard focus lands after it. Pure, so the board's archive keys stay testable.

// The card to focus once `gone` leave a column (`ids` in screen order): the first one below them, else the
// nearest one above, else none.
export function neighborAfter(ids: string[], gone: string[]): string | undefined {
  const leaving = new Set(gone);
  const last = ids.findLastIndex((id) => leaving.has(id));
  if (last < 0) return undefined;
  const below = ids.slice(last + 1).find((id) => !leaving.has(id));
  return below ?? ids.slice(0, last).findLast((id) => !leaving.has(id));
}

// The toast after archiving: the title for one card, a count for several.
export function archivedMessage(titles: string[]): string {
  if (titles.length === 1) return `Archived “${titles[0]}”.`;
  return `Archived ${titles.length} cards.`;
}
