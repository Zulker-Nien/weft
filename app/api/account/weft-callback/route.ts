import { connection } from "next/server";
import { finishSignIn } from "@/lib/account";
import { accountPage } from "@/lib/account-page";
import { fail, guard } from "@/lib/guard";

// Electron main's weft://account-callback handler POSTs the query string here so the OAuth code
// can be exchanged against the PKCE verifier this machine kept in the session file. The HTTP
// loopback callback at /api/account/callback is still used by plain `next dev` (no Electron).
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  await connection();
  const body: Record<string, string> = {};
  try {
    const parsed = (await req.json()) as Record<string, unknown>;
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string") body[key] = value;
    }
  } catch {
    return fail(new Error("Expected a JSON body with the OAuth query string."));
  }
  const failed = body.error_description || body.error;
  if (failed) return accountPage("Couldn't sign in to Weft", failed, false);
  try {
    const user = await finishSignIn(body.code ?? "");
    const who = user.email ?? user.name;
    return Response.json({ ok: true, who });
  } catch (err) {
    return accountPage("Couldn't sign in to Weft", err instanceof Error ? err.message : String(err), false);
  }
}
