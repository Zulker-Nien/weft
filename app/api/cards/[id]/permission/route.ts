import { fail, guard } from "@/lib/guard";
import { answerPermission } from "@/lib/runner";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = guard(req);
  if (denied) return denied;
  const { id } = await params;
  try {
    const { allow, answers, pendingId } = (await req.json()) as {
      allow?: boolean;
      answers?: Record<string, string>;
      pendingId?: string;
    };
    answerPermission(
      id,
      allow === true,
      answers && typeof answers === "object" ? answers : undefined,
      typeof pendingId === "string" ? pendingId : undefined,
    );
    return Response.json({ ok: true });
  } catch (err) {
    return fail(err, 409);
  }
}
