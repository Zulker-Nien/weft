import { SUPABASE_URL } from "@/lib/account";
import { handle, restStore } from "@/lib/webhook-relay";

// A webhook's public URL on the deployed Weft (Vercel): /api/hooks/<relay id>, plus any path or query after it.
// Providers (Stripe, GitHub, Resend…) post here; the relay saves the request on Weft's Supabase for your Weft on
// localhost to hear and forward to the webhook's target (lib/webhook-relay.ts). A provider reaches it, so it has no
// localhost guard: the relay id is the check. SUPABASE_SECRET_KEY is set on the deployment only; a Weft without it says so.

async function relay(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) return new Response("The webhook relay isn't set up on this Weft.", { status: 503 });
  const { id } = await ctx.params;
  // What follows the relay id, as the provider wrote it (still percent-encoded), with its query.
  const url = new URL(req.url);
  const at = url.pathname.indexOf(id) + id.length;
  const extra = `${url.pathname.slice(at)}${url.search}`;
  try {
    return await handle(req, id, extra, restStore(SUPABASE_URL, key));
  } catch (err) {
    console.error(`Webhook relay: ${(err as Error).message}`);
    return new Response("Couldn't save the delivery", { status: 502 });
  }
}

export const GET = relay;
export const POST = relay;
export const PUT = relay;
export const PATCH = relay;
export const DELETE = relay;
