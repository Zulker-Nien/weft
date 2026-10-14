import { fail, guard } from "@/lib/guard";
import { resolveFolder } from "@/lib/folders";
import { ensureSpare, warmUp } from "@/lib/runner";
import type { Backend } from "@/lib/types";

// Starts CLIs ahead of time: a card's own (when its thread is opened) or a spare in a project
// folder (when a project is picked or the new-thread dialog opens).
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as { cardId?: string; cwd?: string; backend?: Backend };
    if (body.cardId) warmUp(body.cardId);
    else if (body.cwd && body.backend !== "codex") ensureSpare(resolveFolder(body.cwd), body.backend === "puku" ? "puku" : "claude");
    return Response.json({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
