import { connection } from "next/server";
import { finishSignIn } from "@/lib/account";
import { accountPage } from "@/lib/account-page";
import { guard } from "@/lib/guard";

// Supabase sends the browser here with ?code=… after GitHub, Google or a magic link. A forged link can't
// sign you in to someone else's account: the code only exchanges with the verifier this machine kept.
export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  const params = new URL(req.url).searchParams;
  const failed = params.get("error_description") || params.get("error");
  if (failed) return accountPage("Couldn't sign in to Weft", failed, false);
  try {
    const user = await finishSignIn(params.get("code") ?? "");
    const who = user.email ?? user.name;
    return accountPage("Signed in to Weft", `${who ? `You're signed in as ${who}. ` : ""}You can close this tab and go back to Weft.`, true);
  } catch (err) {
    return accountPage("Couldn't sign in to Weft", err instanceof Error ? err.message : String(err), false);
  }
}
