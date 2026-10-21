import { connection } from "next/server";
import { elevated, fail, guard } from "@/lib/guard";
import { armRestart, cancelRestart, restartStatus } from "@/lib/restart-when-idle";
import { sendDueMessages } from "@/lib/scheduler";

// Restart when idle (lib/restart-when-idle.ts): GET what it waits on, POST to arm it ({ then: "update" } installs the
// downloaded update instead of a plain relaunch), DELETE to cancel it, which sends the messages it held right away.
// POST arms Weft to quit (or install an update): only Weft's own window can do that (pentest P-4).

export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  return Response.json(restartStatus());
}

export async function POST(req: Request) {
  const denied = elevated(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as { then?: unknown };
  try {
    return Response.json(armRestart(body.then === "update" ? "update" : "relaunch"));
  } catch (err) {
    return fail(err);
  }
}

export function DELETE(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const status = cancelRestart();
  sendDueMessages();
  return Response.json(status);
}
