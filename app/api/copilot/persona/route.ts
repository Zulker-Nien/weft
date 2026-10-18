import { setCopilotPersona } from "@/lib/copilot";
import { isPersona } from "@/lib/copilot-personas";
import { fail, guard } from "@/lib/guard";

// Switches the copilot's persona, which starts a new chat (lib/copilot.ts).
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const { persona } = (await req.json()) as { persona?: unknown };
    if (!isPersona(persona)) return fail(new Error("Unknown persona"));
    return Response.json({ card: await setCopilotPersona(persona) });
  } catch (err) {
    return fail(err);
  }
}
