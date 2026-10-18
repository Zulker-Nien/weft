import { connection } from "next/server";
import { SUPABASE_URL } from "@/lib/account";
import { restMailStore, verifyUnsubscribe } from "@/lib/league-mail-send";

// A league email's unsubscribe link (lib/league-mail-send.ts unsubscribeUrl), on the deployed Weft. GET shows a button,
// so a mail scanner that opens every link doesn't unsubscribe anyone; POST, from that button or a mail app's one-click
// List-Unsubscribe, turns league emails off on the builder's profile. The link's HMAC is the check.

const page = (title: string, body: string, status = 200) =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="margin:0;background:#eef1f6;font:15px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1d2133">
<main style="max-width:440px;margin:80px auto;padding:32px;background:#fff;border:1px solid #e3e5ec;border-radius:16px">
<h1 style="margin:0 0 12px;font-size:22px">${title}</h1>${body}</main></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } },
  );

function check(req: Request): { userId: string } | Response {
  const secret = process.env.LEAGUE_EMAIL_SECRET;
  if (!secret || !process.env.SUPABASE_SECRET_KEY) return page("Not set up", "<p>League emails aren't set up on this Weft.</p>", 503);
  const url = new URL(req.url);
  const userId = url.searchParams.get("u") ?? "";
  const token = url.searchParams.get("t") ?? "";
  if (!userId || !token || !verifyUnsubscribe(userId, token, secret)) return page("Link not valid", "<p>This unsubscribe link isn't valid. Use the one in your latest league email.</p>", 400);
  return { userId };
}

export async function GET(req: Request) {
  await connection();
  const checked = check(req);
  if (checked instanceof Response) return checked;
  return page(
    "Stop league emails?",
    `<p style="color:#555b72">You'll stop getting your weekly league standings and results. Your league in Weft stays as it is.</p>
<form method="post"><button style="padding:12px 22px;border:0;border-radius:10px;background:#b84f72;color:#fff;font:600 15px/1 inherit;cursor:pointer">Stop league emails</button></form>`,
  );
}

export async function POST(req: Request) {
  await connection();
  const checked = check(req);
  if (checked instanceof Response) return checked;
  try {
    await restMailStore(SUPABASE_URL, process.env.SUPABASE_SECRET_KEY ?? "").optOut(checked.userId);
  } catch (err) {
    console.error(`League unsubscribe: ${(err as Error).message}`);
    return page("Something went wrong", "<p>Couldn't turn league emails off just now. Try the link again in a minute.</p>", 502);
  }
  return page("League emails are off", `<p style="color:#555b72">You won't get league emails any more. Your league in Weft stays as it is.</p>`);
}
