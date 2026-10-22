// GET /api/web-board/[orgId]/page/[sha] — the iframe src for the page an open card's browser pane showed, on the
// weft.zip board (components/web-board/WebPane.tsx). Streams weft-blobs/<orgId>/<sha> through the visitor's own
// cookie session, so the bucket's "read as org member" policy is the gate: a non-member's download finds nothing.
// Sent with the share viewer's sandbox (app/api/s/[id]/page/[sha]): the page's scripts run in an opaque origin and
// can't read weft.zip's cookies.
import { NO_STORE } from "@/lib/app-share-reply";
import { webClient } from "@/lib/web-session";

const SHA_RE = /^[0-9a-f]{64}$/;
const ORG_RE = /^[0-9a-f-]{36}$/i;

const HEADERS = {
  "Content-Security-Policy": "sandbox allow-scripts allow-popups allow-forms",
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "private, max-age=300",
} as const;

export async function GET(_req: Request, ctx: { params: Promise<{ orgId: string; sha: string }> }) {
  const { orgId, sha } = await ctx.params;
  if (!SHA_RE.test(sha) || !ORG_RE.test(orgId)) return new Response("Bad request", { status: 400, headers: NO_STORE });
  const supabase = await webClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return new Response("Sign in to see this page.", { status: 401, headers: NO_STORE });
  const { data, error } = await supabase.storage.from("weft-blobs").download(`${orgId}/${sha}`);
  if (error) return new Response("Not found", { status: 404, headers: NO_STORE });
  const type = data.type || "application/octet-stream";
  return new Response(await data.arrayBuffer(), { status: 200, headers: { ...HEADERS, "Content-Type": type } });
}
