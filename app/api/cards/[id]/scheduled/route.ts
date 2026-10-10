import { fail, guard } from "@/lib/guard";
import { scheduleMessage, unscheduleMessage } from "@/lib/scheduler";

// Queue a message to send at a set time: { text, at } with at in unix ms.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = guard(req);
  if (denied) return denied;
  const { id } = await params;
  try {
    const { text, at } = (await req.json()) as { text?: string; at?: number };
    if (!text?.trim()) throw new Error("Write a message first.");
    return Response.json({ card: scheduleMessage(id, text.trim(), Number(at)) });
  } catch (err) {
    return fail(err);
  }
}

// Take a scheduled message back: { messageId }.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = guard(req);
  if (denied) return denied;
  const { id } = await params;
  try {
    const { messageId } = (await req.json()) as { messageId?: string };
    if (!messageId) throw new Error("Which message?");
    return Response.json({ card: unscheduleMessage(id, messageId) });
  } catch (err) {
    return fail(err);
  }
}
