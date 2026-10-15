import { SUPABASE_KEY, SUPABASE_URL } from "@/lib/account";
import { billingService } from "@/lib/billing/billing";
import { billingStatus } from "@/lib/billing/status";
import { accountUserId } from "@/lib/puku-trial-token";

// The desktop's view of the signed-in user's billing (docs/architecture/billing.md). Runs on the deployed Weft
// and is reached from your machine, not from localhost, so it has no localhost guard: the Weft access token is
// the check, the same way /api/puku/trial-token does it. Returns 503 when the deployment hasn't been wired for
// billing yet, 404 when the user has no workspace, and the BillingStatus JSON otherwise.

export async function GET(req: Request) {
  const accessToken = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") ?? "")?.[1]?.trim() ?? "";
  if (!accessToken) return Response.json({ error: "Sign in to your Weft account first." }, { status: 401 });
  const service = billingService();
  if (!service) return Response.json({ error: "Billing isn't set up on this Weft." }, { status: 503 });
  let userId: string | null;
  try {
    userId = await accountUserId(accessToken, SUPABASE_URL, SUPABASE_KEY);
  } catch (err) {
    console.error(`Billing status: ${(err as Error).message}`);
    return Response.json({ error: "Couldn't check your Weft sign-in." }, { status: 502 });
  }
  if (!userId) return Response.json({ error: "Your Weft sign-in has expired. Sign in again." }, { status: 401 });
  try {
    const status = await billingStatus(service, userId);
    if (!status) return Response.json({ error: "No workspace for this account." }, { status: 404 });
    return Response.json(status);
  } catch (err) {
    console.error(`Billing status: ${(err as Error).message}`);
    return Response.json({ error: "Couldn't load billing status." }, { status: 502 });
  }
}
