import { billing, billingService } from "@/lib/billing/billing";

// Stripe's webhook for this app (docs/architecture/billing.md). Mounted on the deployed Weft
// (Vercel), this is the only host Stripe reaches; the signature is the check, so there's no
// localhost guard. The shared AimHuge Stripe account stamps every event with `metadata.app`
// (`"weft"`), and the package drops events stamped for another app — keeping DeckCP and
// BlastCP's webhooks from blowing up here when they share the same account.
export const POST = (req: Request) => billing.handleStripeWebhook(req, billingService);
