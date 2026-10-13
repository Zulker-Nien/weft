// The weft.zip sign-out entry. POST /auth/sign-out signs the visitor out of
// this device only (scope: "local" — a sign-in on another tab / phone
// survives) and 303s to /login. A form submission from the /login banner
// hits this route; a plain GET would let any link trigger a sign-out, so
// the route only accepts POST.
//
// Only on the deployed site: a 404 in `next dev` keeps the desktop's
// /api/account/signout (lib/account.ts `signOut`) the only one in the tree.
import { webClient, webSignOut } from "@/lib/web-auth";
import { isDeployed } from "@/lib/home";

export async function POST(request: Request): Promise<Response> {
  if (!isDeployed()) return new Response("Not Found", { status: 404 });
  const result = await webSignOut(await webClient(), { request, loginPath: "/login" });
  return Response.redirect(result.url, 303);
}
