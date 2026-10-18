import { fail, guard } from "@/lib/guard";
import { stopTask } from "@/lib/task-stop";

// The task strip's Stop: ends one subagent or background command of the thread.
export async function POST(req: Request, { params }: { params: Promise<{ id: string; taskId: string }> }) {
  const denied = guard(req);
  if (denied) return denied;
  const { id, taskId } = await params;
  try {
    await stopTask(id, taskId);
    return Response.json({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
