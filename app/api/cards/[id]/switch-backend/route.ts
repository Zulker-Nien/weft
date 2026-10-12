import { connection } from "next/server";
import { fail, guard } from "@/lib/guard";
import { switchBackend } from "@/lib/runner";
import { getCard } from "@/lib/store";
import type { Backend } from "@/lib/types";

const BACKENDS: Backend[] = ["claude", "puku"];

// One-click "switch this card's CLI" — used by the right-click menu and the rate-limit banner.
// replay=true re-sends the last user message, which is what the rate-limit escape hatch wants.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = guard(req);
  if (denied) return denied;
  const { id } = await params;
  await connection();
  try {
    const card = getCard(id);
    if (!card) return fail("No such card.", 404);
    const body = (await req.json()) as Record<string, unknown>;
    const backend = body.backend;
    if (typeof backend !== "string" || !BACKENDS.includes(backend as Backend)) {
      throw new Error(`backend must be one of ${BACKENDS.join(", ")}.`);
    }
    await switchBackend(id, backend as Backend, { replay: body.replay === true });
    return Response.json({ card: getCard(id) });
  } catch (err) {
    return fail(err);
  }
}
