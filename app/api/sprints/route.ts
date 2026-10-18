import { fail, guard } from "@/lib/guard";
import { listSprints, removeSprint, renameSprint, saveSprint } from "@/lib/sprint-store";

// The Backlog's saved sprints (lib/sprint-store.ts).

type Body = { id?: unknown; cardIds?: unknown; name?: unknown };

export function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  return Response.json({ sprints: listSprints() });
}

// { cardIds, name? }: saves the cards as a sprint.
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as Body;
    return Response.json({ sprint: saveSprint(body.cardIds, body.name) });
  } catch (err) {
    return fail(err);
  }
}

// { id, name }: renames it.
export async function PATCH(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as Body;
    return Response.json({ sprint: renameSprint(body.id, body.name) });
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as Body;
    removeSprint(body.id);
    return Response.json({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
