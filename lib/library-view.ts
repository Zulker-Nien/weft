import type { LibraryItem, LibraryKind } from "./types";

// How the library rail reads (components/LibraryRail.tsx). Pure, so it's testable and safe in the browser.

// "project": the board's project and yours; "mine": only yours; "all": yours and every project's.
export type LibraryView = "project" | "mine" | "all";

function inView(item: LibraryItem, view: LibraryView, project: string | null) {
  if (item.scope === "mine") return true;
  if (view === "mine") return false;
  return view === "all" || item.folder === project;
}

// A to-do with every step ticked is finished.
export function isFinished(item: LibraryItem) {
  return item.kind === "todo" && Boolean(item.steps) && (item.ticked?.length ?? 0) >= item.steps!;
}

// The rail's badges: recipes and notes in view, and to-dos still open.
export function libraryCounts(items: LibraryItem[], view: LibraryView, project: string | null): Record<LibraryKind, number> {
  const counts: Record<LibraryKind, number> = { recipe: 0, todo: 0, note: 0 };
  for (const item of items) {
    if (inView(item, view, project) && !isFinished(item)) counts[item.kind]++;
  }
  return counts;
}

const folderName = (folder: string) => folder.split(/[\\/]/).filter(Boolean).pop() ?? folder;

// One kind's items in view, grouped by project (the board's first, by name) with yours last, newest first
// in each, and finished to-dos at the bottom.
export function libraryGroups(items: LibraryItem[], kind: LibraryKind, view: LibraryView, project: string | null) {
  const groups = new Map<string, { key: string; label: string; items: LibraryItem[] }>();
  for (const item of items) {
    if (item.kind !== kind || !inView(item, view, project)) continue;
    const key = item.scope === "mine" ? "~mine" : item.folder;
    if (!groups.has(key)) groups.set(key, { key, label: item.scope === "mine" ? "Mine" : folderName(item.folder), items: [] });
    groups.get(key)!.items.push(item);
  }
  const order = (key: string) => (key === project ? 0 : key === "~mine" ? 2 : 1);
  return [...groups.values()]
    .sort((a, b) => order(a.key) - order(b.key) || a.label.localeCompare(b.label))
    .map((g) => ({
      ...g,
      items: g.items.sort((a, b) => Number(isFinished(a)) - Number(isFinished(b)) || b.updatedAt - a.updatedAt),
    }));
}

// A to-do's ticks, for its progress bar; undefined when its page has no checkboxes.
export function todoProgress(item: LibraryItem): { fraction: number; label: string } | undefined {
  if (item.kind !== "todo" || !item.steps) return undefined;
  const done = Math.min(item.ticked?.length ?? 0, item.steps);
  return { fraction: done / item.steps, label: done === item.steps ? "All done" : `${done} of ${item.steps} done` };
}

// Pinned, the drawer sits beside the board instead of sliding over it. Remembered per browser.
const PINNED = "weft.libraryPinned";

export function libraryPinned() {
  try {
    return localStorage.getItem(PINNED) === "1";
  } catch {
    return false;
  }
}

export function setLibraryPinned(on: boolean) {
  try {
    localStorage.setItem(PINNED, on ? "1" : "0");
  } catch {}
}

// A blank in a recipe's prompt: {product}, {brand folder}. Code like { a: 1 } isn't one. The prompt editor
// writes Markdown, which escapes an underscore, so {item\_kinds} is still the blank item_kinds.
const BLANK = /\{([A-Za-z](?:[\w -]|\\_){0,39})\}/g;

const blankName = (raw: string) => raw.replace(/\\_/g, "_").trim();

export function blanksIn(prompt: string): string[] {
  return [...new Set([...prompt.matchAll(BLANK)].map((m) => blankName(m[1])))];
}

export function fillBlanks(prompt: string, values: Record<string, string>) {
  return prompt.replace(BLANK, (whole, name: string) => values[blankName(name)]?.trim() || whole);
}
