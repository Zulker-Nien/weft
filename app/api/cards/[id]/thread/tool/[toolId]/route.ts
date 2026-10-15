import { connection } from "next/server";
import { fail, guard } from "@/lib/guard";
import { getCard, getThread } from "@/lib/store";
import { findToolResult } from "@/lib/thread-page";

// The full result of a tool call whose inline result was trimmed (lib/cloud-sync-types.ts
// TOOL_RESULT_INLINE_MAX). The thread row fetches it when opened.
export async function GET(req: Request, { params }: { params: Promise<{ id: string; toolId: string }> }) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  const { id, toolId } = await params;
  const card = getCard(id);
  if (!card) return fail("No such card.", 404);
  const result = findToolResult(getThread(id), toolId);
  if (result === undefined) return fail("No such tool result.", 404);
  return Response.json({ result });
}
