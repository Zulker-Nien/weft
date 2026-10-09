import { guard } from "@/lib/guard";
import { releaseSession } from "@/lib/import";
import { getCard, updateCard } from "@/lib/store";

// Stops the Claude CLI that has this card's session open elsewhere, so the next reply continues the
// same session here instead of a copy.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = guard(req);
  if (denied) return denied;
  const { id } = await params;
  const card = getCard(id);
  if (!card?.sessionId) return Response.json({ error: "No such card." }, { status: 404 });
  const stopped = releaseSession(card.sessionId);
  const updated = updateCard(id, { openElsewhere: false, lastWeftTurn: Date.now() });
  return Response.json({ stopped, card: updated });
}
