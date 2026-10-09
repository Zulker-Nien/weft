import { fail, guard } from "@/lib/guard";
import { syncSessions } from "@/lib/import";

// Picks up new or changed Claude Code sessions now (it also runs every minute on its own).
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    return Response.json(await syncSessions());
  } catch (err) {
    return fail(err, 500);
  }
}
