import { SUPABASE_KEY, SUPABASE_URL } from "@/lib/account";
import { accountUserId, issueTrialToken } from "@/lib/puku-trial-token";

// The Puku trial's tokens, on the deployed Weft (Vercel): your Weft desktop trades your Weft sign-in for a
// day-long token its puku threads use with the proxy beside this route (docs/architecture/puku-trial.md). Reached
// from your machine, not from localhost, so it has no localhost guard: the Weft access token is the check.
// PUKU_TRIAL_SIGNING_SECRET is set on the deployment only; a Weft without it says so.

export async function POST(req: Request) {
  const secret = process.env.PUKU_TRIAL_SIGNING_SECRET;
  if (!secret) return Response.json({ error: "The Puku trial isn't set up on this Weft." }, { status: 503 });
  try {
    return await issueTrialToken(req, secret, (token) => accountUserId(token, SUPABASE_URL, SUPABASE_KEY));
  } catch (err) {
    console.error(`Puku trial token: ${(err as Error).message}`);
    return Response.json({ error: "Couldn't check your Weft sign-in." }, { status: 502 });
  }
}
