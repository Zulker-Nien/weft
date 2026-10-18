// POST /api/s/[id]/unlock — a card link's gate submit (lib/share-unlock.ts: the body, the rate limit, the pass cookie
// and the off-Vercel refusal, shared with a mini app's link). No localhost guard: the route is the public gate.
import { insertShareVisit, loadShare } from "@/lib/share-access";
import { unlockShare } from "@/lib/share-unlock";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return unlockShare(req, id, { load: async (shareId) => (await loadShare(shareId))?.share ?? null, recordVisit: insertShareVisit });
}
