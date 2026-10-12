import path from "node:path";
import { connection } from "next/server";
import { repoRoot } from "@/lib/commit-pile";
import { fail, guard } from "@/lib/guard";
import { mapBacklog, sprintPrompt } from "@/lib/sprint-plan";
import { listCards } from "@/lib/store";

// The Backlog of the repo holding ?cwd= (or of that folder when it isn't a repo), for the header
// counter: how many cards wait there. With &prompt=1, the first message of a card that plans them into
// sprints (lib/sprint-plan.ts); the board starts that card through /api/cards.
export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  const url = new URL(req.url);
  const cwd = url.searchParams.get("cwd");
  if (!cwd) return Response.json({ backlog: null });
  try {
    let root = cwd;
    try {
      root = repoRoot(cwd);
    } catch {}
    const map = mapBacklog(listCards(), root);
    if (!map.backlog.length) return Response.json({ backlog: null });
    const summary = { root, count: map.backlog.length, active: map.active.length };
    if (!url.searchParams.get("prompt")) return Response.json({ backlog: summary });
    const prompt = sprintPrompt({ root, map, origin: url.origin, now: Date.now() });
    return Response.json({ backlog: summary, prompt, title: `Plan the ${path.basename(root)} backlog into sprints` });
  } catch (err) {
    return fail(err, 500);
  }
}
