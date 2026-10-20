// How a drawer's "Link…" picker lists the rows it fetched from a provider's API: keep what the search
// box matches, put the rows that fit the folder first, then the newest. Four pickers need this
// (Vercel, Supabase, Cloudflare, BlastCP) and each has its own score tiers and search columns in its
// view module — this is the shared ranking engine they all call, so a fifth provider is one call, not
// another list UI to write. BlastCP is the exception: it flattens rows across workspaces first
// (lib/blastcp-view.ts propertyOptions) and hands the result straight to the picker.

export interface RankOptions<T> {
  // null while the provider is still listing rows; there is nothing to rank and the picker shows a
  // loading note instead.
  items: T[] | null;
  // The folder being linked, for the best-fit score. Some providers read more off it (Cloudflare its
  // wrangler config), so it is passed through to `score` rather than read here.
  folder: unknown;
  search: string;
  // How well this row fits, higher first. The provider's own matchScore (lib/vercel-view.ts,
  // lib/cloudflare-view.ts, lib/supabase-view.ts): 3+ a repo the folder deploys from, 2 it carries the
  // folder's or its repo's name, 1 a partial, 0 none. DbSelect badges anything at 2 or up "best fit",
  // so a score must agree with that scale.
  score: (item: T) => number;
  // The columns the search box matches, lowercased inside. A row survives when any contains the query.
  keys: (item: T) => (string | null | undefined)[];
  // The tie-break inside one score: the newest first. Omit to keep the provider's own order, which is
  // what BlastCP wants (best fit, then the provider's listing).
  newest?: (item: T) => number;
  // How many rows to show, so a big account doesn't render a thousand buttons.
  limit?: number;
}

// One `{ item, score }` row per surviving item, best fit first.
export function rankItems<T>({ items, search, score, keys, newest, limit }: RankOptions<T>): { item: T; score: number }[] {
  if (!items) return [];
  const q = search.trim().toLowerCase();
  const rows = items
    .filter((item) => !q || keys(item).some((k) => k?.toLowerCase().includes(q)))
    .map((item) => ({ item, score: score(item) }));
  if (newest) rows.sort((a, b) => b.score - a.score || newest(b.item) - newest(a.item));
  else rows.sort((a, b) => b.score - a.score);
  return limit ? rows.slice(0, limit) : rows;
}