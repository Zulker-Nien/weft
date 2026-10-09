import { fail, guard } from "@/lib/guard";
import { endSession, isBusy, sendMessage } from "@/lib/runner";
import { dismissSession } from "@/lib/settings";
import { deleteCard, getCard, updateCard } from "@/lib/store";
import { COLUMNS, type Column } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

// Running and Needs you follow the thread's live state, so they can't be set by hand.
const MANUAL: Column[] = ["backlog", "review", "done"];

export async function PATCH(req: Request, { params }: Ctx) {
  const denied = guard(req);
  if (denied) return denied;
  const { id } = await params;
  try {
    const card = getCard(id);
    if (!card) return fail("No such card.", 404);
    const body = (await req.json()) as { column?: Column; title?: string };

    if (body.title !== undefined) updateCard(id, { title: String(body.title).trim() || card.title });

    if (body.column && body.column !== card.column) {
      if (!COLUMNS.some((c) => c.id === body.column)) throw new Error("Unknown column.");
      if (card.role === "copilot") throw new Error("The copilot isn't on the board.");
      if (isBusy(id)) throw new Error("Stop the thread before moving it.");
      if (body.column === "running") {
        if (card.column !== "backlog") throw new Error("Reply in the thread to run it again.");
        sendMessage(id, card.prompt);
      } else if (MANUAL.includes(body.column)) {
        updateCard(id, { column: body.column });
      } else {
        throw new Error("Cards move to Needs you on their own.");
      }
    }
    return Response.json({ card: getCard(id) });
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(req: Request, { params }: Ctx) {
  const denied = guard(req);
  if (denied) return denied;
  const { id } = await params;
  if (getCard(id)?.role === "copilot") return fail("The copilot can't be deleted. Start a new chat instead.");
  const card = getCard(id);
  await endSession(id);
  // A picked-up session stays deleted; the sync won't bring it back.
  if (card?.source === "claude-code" && card.sessionId) dismissSession(card.sessionId);
  deleteCard(id);
  return Response.json({ ok: true });
}
