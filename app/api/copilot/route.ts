import { connection } from "next/server";
import { ensureCopilot } from "@/lib/copilot";
import { fail, guard } from "@/lib/guard";
import { warmUp } from "@/lib/runner";

export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  try {
    const card = ensureCopilot();
    warmUp(card.id);
    return Response.json({ card });
  } catch (err) {
    return fail(err);
  }
}
