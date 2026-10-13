import { fail, guard } from "@/lib/guard";
import { runShell } from "@/lib/shell";

// "!" in the reply box: starts your command in the card's folder. It answers once the command has started;
// the thread shows its output when it ends.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = guard(req);
  if (denied) return denied;
  const { id } = await params;
  try {
    const { command } = (await req.json()) as { command?: string };
    runShell(id, (command ?? "").trim());
    return Response.json({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
