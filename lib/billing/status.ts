import "server-only";

// The desktop's "what plan is this user on" view (docs/architecture/billing.md). Joins the user's workspace, its
// subscription, and the plan's Puku allowance into the small JSON the board shows. The full billing page lives on
// the deployed Weft at /<orgSlug>/billing; this is just the desktop's read-only status row.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { MeterBalance } from "@aimhuge/billing";
import { billing } from "./billing";
import { orgForUser } from "./org";
import { catalog, PUKU_METER, type PlanId } from "./plans";

// The site billing URLs point at. Configurable so a preview deployment can hand the desktop its own page.
const SITE = process.env.NEXT_PUBLIC_SITE_URL || "https://weft.zip";

export interface BillingStatus {
  org: { slug: string; name: string };
  plan: { id: PlanId; name: string };
  status: string;
  interval: "monthly" | "yearly" | null;
  periodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  // Null when the plan has no Puku allowance (Free: the daily trial cap is what they have).
  puku: MeterBalance | null;
  // The deployed Weft's billing page for this workspace.
  manageUrl: string;
}

// The desktop's view of the user's billing: their workspace, their plan, and the Puku meter (when there is one).
// Null when the user has no workspace at all (a fresh sign-up before the trigger ran, or the org was deleted).
export async function billingStatus(service: SupabaseClient, userId: string): Promise<BillingStatus | null> {
  const org = await orgForUser(service, userId);
  if (!org) return null;
  const sub = await billing.subscription(service, org.id);
  const plan = catalog.get(sub.plan);
  // Only ask the ledger for a balance when the plan's catalog actually has a Puku allowance. Free's plan
  // (and any non-metered status, which billing.balance would map to Free) reports null and the desktop shows
  // the trial cap hint instead.
  const hasPukuAllowance = catalog.allowance(plan.id, PUKU_METER) !== null;
  const puku = hasPukuAllowance ? await billing.balance(service, org.id, PUKU_METER) : null;
  return {
    org: { slug: org.slug, name: org.name },
    plan: { id: plan.id, name: plan.name },
    status: sub.status,
    interval: sub.interval,
    periodEnd: sub.currentPeriodEnd,
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    puku,
    manageUrl: `${SITE.replace(/\/+$/, "")}/${org.slug}/billing`,
  };
}
