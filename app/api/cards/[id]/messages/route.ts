import { sendToCopilot } from "@/lib/copilot";
import { fail, guard } from "@/lib/guard";
import { sendUserMessage } from "@/lib/runner";
import { getCard } from "@/lib/store";
import { COPILOT_ID } from "@/lib/types";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = guard(req);
  if (denied) return denied;
  const { id } = await params;
  try {
    const { text } = (await req.json()) as { text?: string };
    if (!text?.trim()) throw new Error("Write a message first.");
    if (id === COPILOT_ID) sendToCopilot(text.trim());
    else sendUserMessage(id, text.trim());
    return Response.json({ card: getCard(id) });
  } catch (err) {
    return fail(err);
  }
}
