// Electron main's `weft://account-callback` handler (electron/account-link.cjs)
// POSTs the query string here so the OAuth code can be exchanged against the
// PKCE verifier this machine kept in the session file.
//
// In plain `next dev` (no Electron) the loopback `/api/auth/callback` (the GET
// route) does the same job, so the board's sign-in button works without a
// custom protocol registered.
//
// This route is the bridge the desktop app uses: it parses the body, runs the
// same exchange, and returns a tiny success/error page that Electron main
// extracts from the HTML (electron/account-link.cjs:extractErrorMessage) before
// showing it in a native dialog.
import { NextResponse } from "next/server";
import { accountView, finishSignIn } from "@/lib/account";
import { accountPage } from "@/lib/account-page";
import { guard } from "@/lib/guard";

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const body: Record<string, string> = {};
  try {
    const parsed = (await req.json()) as Record<string, unknown>;
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string") body[key] = value;
    }
  } catch {
    return accountPage("Couldn't sign in to Weft", "Expected a JSON body with the OAuth query string.", false);
  }
  const failed = body.error_description || body.error;
  if (failed) return accountPage("Couldn't sign in to Weft", failed, false);
  try {
    const user = await finishSignIn(body.code ?? "");
    const who = user.email ?? user.name;
    return accountPage("Signed in to Weft", `${who ? `You're signed in as ${who}. ` : ""}You can close this tab and go back to Weft.`, true);
  } catch (err) {
    return accountPage("Couldn't sign in to Weft", err instanceof Error ? err.message : String(err), false);
  }
}

// GET returns the current view, so a status check from main doesn't need POST.
export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  try {
    const view = await accountView();
    return NextResponse.json(view);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
