import path from "node:path";
import { connection } from "next/server";
import { mapPile, pilePrompt, readPile, repoCards } from "@/lib/commit-pile";
import { fail, guard } from "@/lib/guard";
import { PLUGIN_DIR } from "@/lib/skills";
import { listCards } from "@/lib/store";

// The uncommitted pile of the repo holding ?cwd=, for the header counter: its size, and how many
// Review cards it belongs to. With &prompt=1, the first message of a card that walks through
// committing it card by card (lib/commit-pile.ts); the board starts that card through /api/cards.
export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  const url = new URL(req.url);
  const cwd = url.searchParams.get("cwd");
  if (!cwd) return Response.json({ pile: null });
  try {
    const pile = readPile(cwd);
    if (!pile) return Response.json({ pile: null });
    const map = mapPile(pile.files, repoCards(listCards(), pile.root), pile.root);
    const summary = {
      root: pile.root,
      files: pile.files.length,
      added: pile.added,
      removed: pile.removed,
      cards: map.cards.filter((c) => c.files.length).length,
    };
    if (!url.searchParams.get("prompt")) return Response.json({ pile: summary });
    const commitScript = path.join(PLUGIN_DIR, "skills", "done", "commit.sh");
    const prompt = pilePrompt({ pile, map, commitScript, origin: url.origin });
    return Response.json({ pile: summary, prompt, title: `Commit the uncommitted pile in ${path.basename(pile.root)}` });
  } catch (err) {
    return fail(err, 500);
  }
}
