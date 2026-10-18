import { fail, guard } from "@/lib/guard";
import { continueInNewCard } from "@/lib/handoff";

// "Continue in new card" on a card with a cold prompt cache: summarizes it and starts a new card with
// the summary, the files it touched and the message typed in the reply box (lib/handoff.ts).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = guard(req);
  if (denied) return denied;
  const { id } = await params;
  try {
    const { message } = (await req.json()) as { message?: string };
    const card = await continueInNewCard(id, message ?? "");
    return Response.json({ card });
  } catch (err) {
    return fail(err);
  }
}
