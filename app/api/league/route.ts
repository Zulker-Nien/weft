import { connection } from "next/server";
import { fail, guard } from "@/lib/guard";
import { leagueView, tierView } from "@/lib/league-sync";

// Your league this week (the 🏆 chip, the Loom's League tab): posts your week first, then reads the standings.
// ?tier=N reads every league of that tier instead, for the Leagues dialog (lib/league-sync.ts).
export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  try {
    const tier = new URL(req.url).searchParams.get("tier");
    if (tier !== null) return Response.json({ tier: await tierView(Number(tier)) });
    return Response.json({ league: await leagueView() });
  } catch (err) {
    return fail(err, 500);
  }
}
