import { fail, guard } from "@/lib/guard";
import { answerPermission } from "@/lib/runner";
import type { QuestionReply } from "@/lib/types";

// A question's notes (string notes and preview per question) and its "Chat about this" message, from an untrusted body.
function readReply(body: { annotations?: unknown; chat?: unknown }): QuestionReply | undefined {
  const reply: QuestionReply = {};
  if (body.annotations && typeof body.annotations === "object") {
    const annotations: NonNullable<QuestionReply["annotations"]> = {};
    for (const [question, value] of Object.entries(body.annotations as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      const { notes, preview } = value as Record<string, unknown>;
      const note = {
        ...(typeof notes === "string" && notes.trim() ? { notes } : {}),
        ...(typeof preview === "string" && preview ? { preview } : {}),
      };
      if (Object.keys(note).length) annotations[question] = note;
    }
    if (Object.keys(annotations).length) reply.annotations = annotations;
  }
  if (typeof body.chat === "string" && body.chat.trim()) reply.chat = body.chat;
  return Object.keys(reply).length ? reply : undefined;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = guard(req);
  if (denied) return denied;
  const { id } = await params;
  try {
    const body = (await req.json()) as {
      allow?: boolean;
      answers?: Record<string, string>;
      pendingId?: string;
      annotations?: unknown;
      chat?: unknown;
    };
    const { allow, answers, pendingId } = body;
    answerPermission(
      id,
      allow === true,
      answers && typeof answers === "object" ? answers : undefined,
      typeof pendingId === "string" ? pendingId : undefined,
      readReply(body),
    );
    return Response.json({ ok: true });
  } catch (err) {
    return fail(err, 409);
  }
}
