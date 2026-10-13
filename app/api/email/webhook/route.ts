import { handle, restMailer } from "@/lib/email-forward";

// Resend's email.received deliveries for Weft's domain, on the deployed Weft (Vercel): each mail to weft.zip is read back
// from Resend and sent on to the inbox in EMAIL_FORWARD_TO (lib/email-forward.ts, docs/architecture/email-forwarding.md).
// The only route Resend reaches, so it has no localhost guard: the delivery's Svix signature is the check. The three
// variables are set on the deployment only; a Weft without them says so.

const FORWARD_FROM = "forward@weft.zip";

export async function POST(req: Request) {
  const key = process.env.RESEND_API_KEY;
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  const to = process.env.EMAIL_FORWARD_TO;
  if (!key || !secret || !to) return new Response("Email forwarding isn't set up on this Weft.", { status: 503 });
  try {
    return await handle(req, { secret, to, from: process.env.EMAIL_FORWARD_FROM || FORWARD_FROM, mailer: restMailer(key) });
  } catch (err) {
    console.error(`Email webhook: ${(err as Error).message}`);
    return new Response("Couldn't forward the email", { status: 502 });
  }
}
