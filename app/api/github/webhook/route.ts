import { SUPABASE_URL } from "@/lib/account";
import { handle, restStore } from "@/lib/github-relay";

// GitHub's webhook deliveries, on the deployed Weft (Vercel), relayed to Weft's Supabase for your Weft on localhost
// to hear (lib/github-relay.ts). The only route GitHub reaches, so it has no localhost guard: the hook's signature
// is the check. SUPABASE_SECRET_KEY is set on the deployment only; a Weft without it says so.

export async function POST(req: Request) {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) return new Response("The webhook relay isn't set up on this Weft.", { status: 503 });
  try {
    return await handle(req, restStore(SUPABASE_URL, key));
  } catch (err) {
    console.error(`GitHub webhook: ${(err as Error).message}`);
    return new Response("Couldn't save the event", { status: 502 });
  }
}
