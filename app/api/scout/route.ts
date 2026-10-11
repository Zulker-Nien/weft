import { connection } from "next/server";
import { fail, guard } from "@/lib/guard";
import { markStarted, scoutState } from "@/lib/scout";

// The refactor scout for the project in ?cwd=: its cached findings, scouted in the background the first time.
export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  const cwd = new URL(req.url).searchParams.get("cwd");
  if (!cwd) return Response.json({ scout: null });
  try {
    return Response.json({ scout: scoutState(cwd) });
  } catch (err) {
    return fail(err, 500);
  }
}

// { cwd } re-scouts now; { cwd, started } marks a finding as handed to a card.
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const { cwd, started } = (await req.json()) as { cwd?: unknown; started?: unknown };
    if (typeof cwd !== "string" || !cwd) return fail("cwd is required");
    if (typeof started === "string") markStarted(cwd, started);
    return Response.json({ scout: scoutState(cwd, { force: typeof started !== "string" }) });
  } catch (err) {
    return fail(err, 500);
  }
}
