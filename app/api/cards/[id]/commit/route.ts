import path from "node:path";
import { fail, guard } from "@/lib/guard";
import { commitFromPage, parseCommitRequest } from "@/lib/pile-commit";
import { PLUGIN_DIR } from "@/lib/skills";
import { getCard } from "@/lib/store";

// A commit walk-through button (weft://commit, forwarded by electron/main.cjs): commit these paths, push
// and move the change's card to Done, with no turn (lib/pile-commit.ts). A failure is still a 200: the
// result says which step failed, and the thread has been asked to step in.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = guard(req);
  if (denied) return denied;
  const { id } = await params;
  try {
    if (!getCard(id)) return fail("No such card.", 404);
    const request = parseCommitRequest((await req.json()) as Record<string, unknown>);
    const script = path.join(PLUGIN_DIR, "skills", "done", "commit.sh");
    return Response.json({ result: await commitFromPage(id, request, script) });
  } catch (err) {
    return fail(err);
  }
}
