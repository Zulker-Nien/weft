// POST /api/a/[id]/unlock — a mini app link's gate submit (lib/share-unlock.ts). No localhost guard: the route is
// the public gate.
import { insertAppShareVisit, loadAppShare } from "@/lib/app-share-access";
import { unlockShare } from "@/lib/share-unlock";
import { serviceClient } from "@/lib/web-session";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return unlockShare(req, id, {
    load: async (shareId) => {
      const service = serviceClient();
      return service ? loadAppShare(service, shareId) : null;
    },
    recordVisit: insertAppShareVisit,
  });
}
