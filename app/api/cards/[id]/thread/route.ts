import { connection } from "next/server";
import { fail, guard } from "@/lib/guard";
import { loadTranscript } from "@/lib/import";
import { getCard, getThread } from "@/lib/store";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  const { id } = await params;
  const card = getCard(id);
  if (!card) return fail("No such card.", 404);
  try {
    await loadTranscript(card);
  } catch (err) {
    console.error("Couldn't read the session transcript:", err);
  }
  return Response.json({ items: getThread(id) });
}
