# Email forwarding for weft.zip

Weft's own domain, weft.zip, forwards every mail it gets to one inbox. Nothing runs on your Mac: Resend receives the
mail, and the deployed Weft on Vercel sends it on.

## The flow

1. **DNS.** weft.zip is on Vercel DNS (the fastmonitor team; `vercel dns ls weft.zip`). Its MX record sends all mail for
   the domain to Resend; Resend's DKIM and return-path (SPF) records let Weft send from the domain. The registrar
   (Namecheap) must delegate to `ns1.vercel-dns.com` and `ns2.vercel-dns.com` exactly.
2. **Resend receives** the mail, keeps it, and posts an `email.received` event to
   `https://weft-topaz.vercel.app/api/email/webhook`. The event holds metadata only (ids, addresses, subject, attachment
   names); the body stays on Resend. A down endpoint loses nothing: Resend retries, and the mail stays readable on
   resend.com either way.
3. **`app/api/email/webhook/route.ts`** is the only route Resend reaches, so it has no localhost guard (`lib/guard.ts`):
   the delivery's signature is the check. Without `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET` and `EMAIL_FORWARD_TO` it
   answers 503 ("isn't set up"), so a local Weft is never a forwarder by accident.
4. **`lib/email-forward.ts`** checks the signature (Svix's: `svix-id`, `svix-timestamp`, `svix-signature`; base64
   HMAC-SHA256 of `id.timestamp.body` keyed by the `whsec_` secret, base64-decoded; a timestamp more than 5 minutes off
   is a replay), reads the mail back (`GET /emails/receiving/{id}`), lists its attachments and downloads the real ones
   (inline images are already in the HTML as data URIs), and sends it on (`POST /emails`).
5. **The forwarded mail** comes from `forward@weft.zip` (or `EMAIL_FORWARD_FROM`), named `"<sender> via <alias>"` so the
   inbox shows who wrote and to which address; `reply_to` is the sender (or their reply-to), so a reply from Gmail goes
   straight back; the original From and To ride along as `X-Forwarded-From` and `X-Forwarded-To`.

## Setting it up (once)

- `scripts/resend-domain.mjs` (`npm run resend -- …`) talks to Resend's API through the vault (`mcp__secrets__run` with
  `RESEND_API_KEY`), so the key never shows in a thread: `create weft.zip` adds the domain with sending and receiving on
  and prints its DNS records; `verify weft.zip` asks Resend to check them; `status weft.zip` prints them; `webhook <url>`
  subscribes the route to `email.received`; `webhooks` lists them. It needs a **Full access** key: a sending-only key
  can't list domains or read received mail, and the forwarder needs the same key on the deployment.
- The records go on Vercel DNS with `vercel dns add weft.zip <name> <type> <value> [priority]`.
- The webhook's signing secret goes in the vault as `RESEND_WEBHOOK_SECRET` and to Vercel with
  `mcp__secrets__push_to_vercel`; `EMAIL_FORWARD_TO` is a plain production env var (`vercel env add`).

## Responses

| Status | When |
|---|---|
| 200 `Forwarded as <id>` | sent on |
| 202 `Ignored <type>` | any other event, or one without an email id |
| 400 | the body isn't JSON |
| 401 | missing headers, a stale timestamp, or a bad signature |
| 405 | not a POST |
| 502 | Resend's API failed (the route logs why); Resend retries the delivery |
| 503 | the deployment has no key, secret or inbox |

## Tests

`lib/email-forward.test.ts` covers the signature against Node's own HMAC, every refusal, the built mail, the handler with
a fake Mailer, and the REST client against a fake `fetch`; `app/api/email-route.test.ts` the route's env check and error
path. Both at 100%.

## Known gaps

- Resend sends up to 40 MB per mail; a bigger set of attachments fails with 502, and Resend's retries fail the same way.
  The mail itself stays readable on resend.com.
- One inbox for the whole domain: no per-alias routing, and no DMARC record yet.
- The forwarded mail is signed by weft.zip, not the sender's domain, so Gmail shows it as sent via weft.zip.
