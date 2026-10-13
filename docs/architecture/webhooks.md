# Webhooks

Status: built 2026-10-13. The relay's migration (`supabase/migrations/20261013150000_webhook_relays.sql`) and the
deployed receiver go live with the next migration push and Vercel deploy.

🪝 sits on the rail right under 🔐 and works like it: a list per project of the webhooks its code receives, kept by
the threads that write that code, with a count of the ones not set up yet. A webhook here is a provider (Stripe,
GitHub, Resend…) posting to a local route (`/api/stripe/webhook`). Two halves, used apart or together:

- **A to-do list.** A thread that writes a webhook route records it (`mcp__webhooks__add_blank`): its name, the local
  route it reaches (`target`), the provider's events, a hint for where to register it and its signing secret's vault
  name. Until the provider sends to it, it's a **blank**: 🪝's count, like 🔐's missing values.
- **A public URL that reaches your dev server.** A dev server on localhost can't be reached from outside, so a webhook
  can get a relay URL on the deployed Weft, `https://weft-topaz.vercel.app/api/hooks/<id>`. Register that URL with
  the provider and its deliveries arrive at `target`, byte for byte, while Weft runs: like `stripe listen` or a
  tunnel, for any provider. It needs a Weft account (the relay rows are yours).

## The registry

`lib/webhooks.ts`, `~/.weft/webhooks.json`. A `Webhook` is `{ id, folder, name, target, events?, hint?, secret?,
registered?, url?, relayId?, deliveries? }`, one per name in a folder. `target` is only ever on this Mac
(`localhost`, `127.0.0.1`, `[::1]`); a bare path goes to `http://localhost:3000`. Adding a name that's there
already fills in what's given and keeps the rest, like the vault's `add_blank`. `deliveries` keeps the latest 10
forwarded (method, the local route's status or 0 for unreachable, time taken), and a webhook that gets one is
registered from then on. Names and URLs only: the signing secret is a 🔐 vault name, and its value stays there.

## Threads: `mcp__webhooks__*`

`lib/webhook-tools.ts`, in every card thread beside `mcp__secrets__*` (`lib/runner-session.ts`), auto-allowed
(`isTrustedTool`). The tools run in the Next server and call the registry directly.

| Tool | What it does |
| --- | --- |
| `list` | The project's webhooks: target, events, blank or registered, relay URL, secret name, last delivery. |
| `add_blank` | Records a webhook the code needs; a `secret` name also goes into the 🔐 vault as a blank. Nothing opens. |
| `ask_add` | The same, then opens 🪝 on it (`POST /webhooks/ask-add` on the control server → the board's `add-webhook` message), for when the thread is blocked on it. |
| `relay` | Gives it a public relay URL, to register at the provider (its dashboard in the pane, or a CLI). |
| `mark_registered` | The thread registered it at the provider itself. |

`WEBHOOKS_PROMPT` tells threads to record each webhook as soon as they know its route, use `relay` rather than a
tunnel, register it themselves when they can and `ask_add` only when blocked.

## The relay

```
provider ─▶ /api/hooks/<id>[/…] on Vercel ─▶ webhook_deliveries row ─▶ Realtime ─▶ your Weft ─▶ target
```

1. **Create.** `lib/webhook-forward.ts` `createRelay` inserts a `webhook_relays` row on your account (RLS: yours
   only) and keeps its id and URL on the webhook.
2. **Receive.** `app/api/hooks/[id]/…` on the deployment (no localhost guard: the unguessable id is the address)
   runs `lib/webhook-relay.ts`: any method, at most 1 MB, headers minus hop-by-hop and Vercel's own, the body as
   base64 so a provider's signature still checks, saved with the Supabase secret key. Rows older than a day go.
3. **Forward.** Your Weft listens for its `webhook_deliveries` inserts (Realtime, like the GitHub relay), reads each
   row, sends it to `target` with the same method, headers and body, records the delivery, and deletes the row, so
   payloads don't wait on Weft's Supabase. Deliveries that came while Weft was closed (under a day old) are
   forwarded when it starts. The provider gets 200 from the relay either way: your route's own answer shows in the
   drawer, not to the provider.

## The drawer

`components/WebhooksDrawer.tsx`, `lib/use-webhooks.ts` (loads through `/api/webhooks`, polls while open so
deliveries show), `lib/webhooks-view.ts` (pure). A project filter like the vault's; a row per webhook with a
**blank** pill until it's registered; open a row for its relay URL (Copy, or **Get a public URL**), hint, secret
name, the latest deliveries, **Mark registered** and Remove. `+ Add` takes the same fields a thread gives.

## Gaps

- The relay answers the provider before your route runs, so a provider that reads the reply (a URL verification
  challenge) doesn't see your route's answer.
- One Weft per account forwards: two Macs signed in to the same account race for each delivery.
