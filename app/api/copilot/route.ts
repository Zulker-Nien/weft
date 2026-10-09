import { connection } from "next/server";
import { ensureCopilot } from "@/lib/copilot";
import { warmUp } from "@/lib/runner";
import { guard } from "@/lib/guard";

export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  const card = ensureCopilot();
  warmUp(card.id);
  return Response.json({ card });
}
