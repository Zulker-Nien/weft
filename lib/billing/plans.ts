// Weft's plan catalog (docs/architecture/billing.md): the Free and Pro plans and their per-meter allowances.
// Client-safe: a board-side plan picker can import the catalog and the prices without pulling in Supabase or Stripe.

import { defineCatalog, type BasePlan } from "@aimhuge/billing";

export type PlanId = "free" | "pro";

export interface Plan extends BasePlan<PlanId> {
  // A short marketing line for the plan picker; not used by billing math.
  blurb: string;
}

// The usage ledger's meters. Tokens count input + output, the same way lib/puku-proxy.ts already does it
// (cache writes are part of input, cache reads don't count).
export const PUKU_METER = "puku_tokens";

// Pro's monthly Puku allowance, in tokens. A placeholder the user will tune — match this in Stripe prices,
// and the number `org_usage_total` caps with, if you add one.
export const PRO_PUKU_TOKENS = 300_000_000;

export const catalog = defineCatalog<PlanId, Plan>({
  plans: {
    free: { id: "free", name: "Free", blurb: "Today's trial: a daily Puku cap on the deployed Weft.", monthlyUnitAmountCents: 0, perSeat: false },
    pro: {
      id: "pro",
      name: "Pro",
      blurb: "Weft's full Puku allowance, refreshed every billing period.",
      monthlyUnitAmountCents: 2000,
      perSeat: false,
      allowances: { [PUKU_METER]: { amount: PRO_PUKU_TOKENS } },
    },
  },
  // Cheapest first: defines what counts as an upgrade and the catalog's display order.
  order: ["free", "pro"],
  free: "free",
  // "Two months free" on a yearly Pro term.
  yearlyMonthsCharged: 10,
});
