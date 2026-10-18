-- Webhook relays (docs/architecture/webhooks.md). A provider (Stripe, GitHub, Resend…) can't reach a dev server on
-- localhost, so each webhook can get a relay: a public URL on the deployed Weft (Vercel, lib/webhook-relay.ts,
-- app/api/hooks/[id]/[[...rest]]/route.ts) at /api/hooks/<relay id>. The relay saves every request it gets as a
-- webhook_deliveries row; the owner's Weft hears it through Realtime, forwards it to the webhook's local target
-- byte for byte (lib/webhook-forward.ts) and deletes the row, so payloads don't sit on Weft's Supabase.

-- One relay per webhook that has a public URL. The id is the URL: unguessable, so it is the only check the relay makes
-- (the provider's own signature is checked by the app at the target, with the body kept byte-exact for that).
create table public.webhook_relays (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

alter table public.webhook_relays enable row level security;

create policy "webhook_relays: read own" on public.webhook_relays
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "webhook_relays: add own" on public.webhook_relays
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "webhook_relays: remove own" on public.webhook_relays
  for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.webhook_relays from anon, authenticated;
grant select (id, user_id, name, created_at) on public.webhook_relays to authenticated;
grant insert (name) on public.webhook_relays to authenticated;
grant delete on public.webhook_relays to authenticated;

-- What a provider sent to a relay, until your Weft has forwarded it. path is whatever followed the relay id in the
-- URL ("/sub", "?foo=1", "/sub?foo=1"); body is the request body in base64, byte-exact so the signature the provider
-- computed over it still checks out. Only the relay (with a secret key) writes rows; it clears a relay's rows older
-- than a day as it adds one.
create table public.webhook_deliveries (
  id bigint generated always as identity primary key,
  relay_id uuid not null references public.webhook_relays (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  method text not null,
  path text not null default '',
  headers jsonb not null default '{}'::jsonb,
  body text not null default '',
  created_at timestamptz not null default now()
);

create index webhook_deliveries_relay_created on public.webhook_deliveries (relay_id, created_at);
create index webhook_deliveries_user on public.webhook_deliveries (user_id);

alter table public.webhook_deliveries enable row level security;

create policy "webhook_deliveries: read own" on public.webhook_deliveries
  for select to authenticated using ((select auth.uid()) = user_id);
-- Your Weft deletes a row once it has forwarded it.
create policy "webhook_deliveries: remove own" on public.webhook_deliveries
  for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.webhook_deliveries from anon, authenticated;
grant select, delete on public.webhook_deliveries to authenticated;

-- Realtime sends each new row to its owner (it applies the select policy above).
alter publication supabase_realtime add table public.webhook_deliveries;
