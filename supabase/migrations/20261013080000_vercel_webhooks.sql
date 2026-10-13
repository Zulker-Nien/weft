-- Vercel env-variable webhooks relayed to Weft (docs/architecture/vercel.md). Weft runs on localhost, which Vercel
-- can't reach, so a team's webhook posts to the relay on the deployed Weft (lib/vercel-relay.ts) instead: it checks
-- the delivery against the hook's secret and saves a row in vercel_events, which the owner's Weft hears through
-- Realtime and pulls that project's new plain variables into its 🔐 vault. No value ever passes through here.

-- One webhook per Weft account and Vercel team. Vercel makes the secret; Weft keeps it here for the relay, and only
-- the relay (with a secret key) reads it back.
create table public.vercel_hooks (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  team_id text not null,
  vercel_hook_id text not null,
  secret text not null,
  created_at timestamptz not null default now(),
  unique (user_id, team_id)
);

alter table public.vercel_hooks enable row level security;

create policy "vercel_hooks: read own" on public.vercel_hooks
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "vercel_hooks: add own" on public.vercel_hooks
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "vercel_hooks: remove own" on public.vercel_hooks
  for delete to authenticated using ((select auth.uid()) = user_id);

-- The secret goes in once and never comes back out to a client.
revoke all on public.vercel_hooks from anon, authenticated;
grant select (id, user_id, team_id, vercel_hook_id, created_at) on public.vercel_hooks to authenticated;
grant insert (id, team_id, vercel_hook_id, secret) on public.vercel_hooks to authenticated;
grant delete on public.vercel_hooks to authenticated;

-- What Vercel sent, minus the payload: the project is all Weft needs to know what to pull. Only the relay writes
-- rows; it clears a hook's rows older than a day as it adds one.
create table public.vercel_events (
  id bigint generated always as identity primary key,
  hook_id uuid not null references public.vercel_hooks (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  team_id text not null,
  project_id text not null,
  type text not null,
  event_id text unique,
  created_at timestamptz not null default now()
);

create index vercel_events_hook_created on public.vercel_events (hook_id, created_at);
create index vercel_events_user on public.vercel_events (user_id);

alter table public.vercel_events enable row level security;

create policy "vercel_events: read own" on public.vercel_events
  for select to authenticated using ((select auth.uid()) = user_id);

revoke all on public.vercel_events from anon, authenticated;
grant select on public.vercel_events to authenticated;

-- Realtime sends each new row to its owner (it applies the select policy above).
alter publication supabase_realtime add table public.vercel_events;
