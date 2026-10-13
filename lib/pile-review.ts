// The review walk-through's first message, from /api/pile (lib/commit-pile.ts): what the header's "+N/-N"
// counter and the Review column's "Review all" button both start as a card. Rejects when there is nothing
// uncommitted to walk through.
export async function fetchPileReview(cwd: string) {
  const r = await fetch(`/api/pile?cwd=${encodeURIComponent(cwd)}&prompt=1`);
  const d = (await r.json()) as { prompt?: string; title?: string; error?: string };
  if (!d.prompt) throw new Error(d.error ?? "Nothing uncommitted to walk through.");
  return { prompt: d.prompt, title: d.title ?? "Commit the uncommitted pile" };
}

// "Review all": start the walk-through card, then open it, so it doesn't land unseen in a busy Review column.
export async function startPileReview(
  cwd: string,
  start: (cwd: string, prompt: string, title: string) => Promise<string | undefined>,
  open: (id: string) => void,
) {
  const { prompt, title } = await fetchPileReview(cwd);
  const id = await start(cwd, prompt, title);
  if (id) open(id);
}
