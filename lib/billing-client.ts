import { accountClient, SUPABASE_KEY } from "./account";
import { TRIAL_URL } from "./puku-trial";
import type { BillingStatus } from "./billing/status";

// The desktop's bridge to the deployed Weft's billing endpoint (docs/architecture/billing.md). We don't host
// billing here — the deployed Weft does, and the page lives at /<orgSlug>/billing. This client only fetches
// the status the Settings → Weft account section shows next to the sign-in form.

// Same deployment as the Puku trial: WEFT_BILLING_URL lets a preview or fork point at its own deployed Weft.
const BASE = (process.env.WEFT_BILLING_URL || TRIAL_URL.replace(/\/api\/puku$/, "")).replace(/\/+$/, "");

export type BillingClientResult = BillingStatus | { error: string } | null;

// Calls the deployed Weft's /api/billing/status with the signed-in user's access token. null when signed out
// (so the section can hide itself), { error } on a network or non-OK reply with a short human message.
export async function fetchBillingStatus(): Promise<BillingClientResult> {
  if (!SUPABASE_KEY) return null;
  const { data } = await accountClient().auth.getSession();
  const token = data.session?.access_token;
  if (!token) return null;
  let res: Response;
  try {
    res = await fetch(`${BASE}/api/billing/status`, { headers: { authorization: `Bearer ${token}` } });
  } catch (err) {
    return { error: `Couldn't reach Weft's billing: ${(err as Error).message}` };
  }
  // 404 (a deployment without billing yet, or no workspace) and 503 (billing not set up there) aren't errors you
  // can act on, so the section stays hidden rather than showing them.
  if (res.status === 404 || res.status === 503) return null;
  const body = (await res.json().catch(() => ({}))) as { error?: unknown } & Partial<BillingStatus>;
  if (!res.ok) {
    return { error: typeof body.error === "string" ? body.error : `Weft's billing answered ${res.status}.` };
  }
  return body as BillingStatus;
}
