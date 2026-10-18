import { connection } from "next/server";
import { fail, guard } from "@/lib/guard";
import { leagueView } from "@/lib/league-sync";

// Your league this week for the Loom's League tab: posts your week first, then reads the standings (lib/league-sync.ts).
export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  try {
    return Response.json({ league: await leagueView() });
  } catch (err) {
    return fail(err, 500);
  }
}
