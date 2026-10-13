// The weft.zip sign-in entry. GET /auth/sign-in?provider=github|google&next=/path
// starts an OAuth round trip with a per-visitor cookie session (lib/web-session.ts);
// the browser is sent to the provider, the provider comes back to /auth/callback,
// and /auth/callback exchanges the code for a session and lands on `next`.
//
// Only on the deployed site: the desktop app signs in through the board's
// AccountButton (lib/account.ts), not this URL. A 404 in `next dev` keeps the
// route out of the way for the desktop's localhost loopback.
import { startWebSignIn, webClient, webSignInErrorUrl } from "@/lib/web-auth";
import { isDeployed } from "@/lib/home";

const DEFAULT_NEXT = "/team";

export async function GET(request: Request): Promise<Response> {
  if (!isDeployed()) return new Response("Not Found", { status: 404 });
  const url = new URL(request.url);
  const provider = url.searchParams.get("provider") ?? "";
  const next = url.searchParams.get("next") ?? DEFAULT_NEXT;
  const result = await startWebSignIn(await webClient(), {
    provider,
    origin: url.origin,
    next,
    defaultNext: DEFAULT_NEXT,
  });
  if (result.kind === "error") return Response.redirect(webSignInErrorUrl(url.origin, result.reason), 303);
  return Response.redirect(result.url, 303);
}
