import { guard } from "@/lib/guard";
import { stop } from "@/lib/runner";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = guard(req);
  if (denied) return denied;
  const { id } = await params;
  await stop(id);
  return Response.json({ ok: true });
}
