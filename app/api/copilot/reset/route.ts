import { resetCopilot } from "@/lib/copilot";
import { guard } from "@/lib/guard";

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  return Response.json({ card: await resetCopilot() });
}
