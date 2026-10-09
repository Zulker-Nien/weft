import { fail, guard } from "@/lib/guard";
import { sendMessage } from "@/lib/runner";
import { getCard } from "@/lib/store";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = guard(req);
  if (denied) return denied;
  const { id } = await params;
  try {
    const { text } = (await req.json()) as { text?: string };
    if (!text?.trim()) throw new Error("Write a message first.");
    sendMessage(id, text.trim());
    return Response.json({ card: getCard(id) });
  } catch (err) {
    return fail(err);
  }
}
