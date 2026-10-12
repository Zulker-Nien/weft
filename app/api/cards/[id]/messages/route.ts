import { sendToCopilot } from "@/lib/copilot";
import { fail, guard } from "@/lib/guard";
import { restartTurn } from "@/lib/restart";
import { sendUserMessage } from "@/lib/runner";
import { getCard } from "@/lib/store";
import { COPILOT_ID } from "@/lib/types";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = guard(req);
  if (denied) return denied;
  const { id } = await params;
  try {
    // restart runs your last message again in a fresh CLI (a stopped card's Restart button).
    const { text, restart } = (await req.json()) as { text?: string; restart?: boolean };
    if (restart) {
      await restartTurn(id);
      return Response.json({ card: getCard(id) });
    }
    if (!text?.trim()) throw new Error("Write a message first.");
    if (id === COPILOT_ID) sendToCopilot(text.trim());
    else sendUserMessage(id, text.trim());
    return Response.json({ card: getCard(id) });
  } catch (err) {
    return fail(err);
  }
}
