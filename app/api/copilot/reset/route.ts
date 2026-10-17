import { resetCopilot } from "@/lib/copilot";
import { fail, guard } from "@/lib/guard";

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    return Response.json({ card: await resetCopilot() });
  } catch (err) {
    return fail(err);
  }
}
