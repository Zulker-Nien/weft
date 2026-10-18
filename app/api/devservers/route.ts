import { connection } from "next/server";
import { listDev } from "@/lib/devserver-list";
import { restartDev, stopDev } from "@/lib/devserver";
import { fail, guard } from "@/lib/guard";
import { stopTask } from "@/lib/task-stop";

// Every dev server Weft knows about (the Services drawer reads /api/services), and the actions to stop or
// restart one. Reads need no x-weft-token header; writes do (guard()). Kept as the dev-server-only
// surface for a future web board.
export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  return Response.json({ servers: await listDev() });
}

// stop: end the server (a Weft-started run, or a background shell task when taskId is given).
// restart: stop then start the Weft run with its original command/cwd/url/title.
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const { action, cardId, taskId } = (await req.json().catch(() => ({}))) as { action?: string; cardId?: string; taskId?: string };
  if (!cardId) return fail("cardId is required.");
  if (action === "stop") {
    if (taskId) await stopTask(cardId, taskId);
    else stopDev(cardId);
  } else if (action === "restart") {
    await restartDev(cardId);
  } else return fail("Unknown action.");
  return Response.json({ ok: true });
}
