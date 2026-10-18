import { connection } from "next/server";
import { SUPABASE_URL } from "@/lib/account";
import { resendSender, restMailStore, runLeagueMails } from "@/lib/league-mail-send";

// The daily league-email run (lib/league-mail-send.ts), on the deployed Weft: Vercel's cron (vercel.json) calls it at
// 13:00 UTC with `Authorization: Bearer $CRON_SECRET`. No localhost guard, since Vercel isn't localhost: the secret is
// the check. A Weft missing any of the four variables says so and sends nothing.

const SITE = "https://weft.zip";

export async function GET(req: Request) {
  await connection();
  const env = process.env;
  const cron = env.CRON_SECRET;
  if (!cron || req.headers.get("authorization") !== `Bearer ${cron}`) return new Response("Unauthorized", { status: 401 });
  const key = env.SUPABASE_SECRET_KEY;
  const resend = env.RESEND_API_KEY;
  const secret = env.LEAGUE_EMAIL_SECRET;
  if (!key || !resend || !secret) return new Response("League emails aren't set up on this Weft.", { status: 503 });
  try {
    const result = await runLeagueMails({
      store: restMailStore(SUPABASE_URL, key),
      send: resendSender(resend),
      origin: env.NEXT_PUBLIC_SITE_URL || SITE,
      secret,
      now: Date.now(),
    });
    if (result.failed.length) console.error(`League emails: ${result.failed.join("; ")}`);
    return Response.json(result);
  } catch (err) {
    console.error(`League emails: ${(err as Error).message}`);
    return new Response("Couldn't run the league emails", { status: 502 });
  }
}
