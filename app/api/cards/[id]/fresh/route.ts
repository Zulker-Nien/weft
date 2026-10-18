import { fail, guard } from "@/lib/guard";
import { sendFresh } from "@/lib/splice";

// "Send fresh" on a card with a cold prompt cache: a new session in the same card, started from a brief of the
// thread, with the message typed in the reply box (lib/splice.ts).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = guard(req);
  if (denied) return denied;
  const { id } = await params;
  try {
    const { message } = (await req.json()) as { message?: string };
    await sendFresh(id, message ?? "");
    return Response.json({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
