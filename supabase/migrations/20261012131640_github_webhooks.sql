-- GitHub webhooks relayed to Weft (docs/architecture/github-issues.md). Weft runs on localhost, which GitHub can't
-- reach, so a repo's webhook posts to the relay on the deployed Weft (Vercel, lib/github-relay.ts) instead: it checks
-- the delivery against the hook's secret and saves a row in github_events, which the owner's Weft hears through
-- Realtime and syncs that repo.

-- One webhook per Weft account and repo. Weft makes the secret and gives it to GitHub; only the relay (with a
-- secret key) reads it back.
create table public.github_hooks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  repo text not null,
  github_hook_id bigint,
  secret text not null,
  created_at timestamptz not null default now(),
  unique (user_id, repo)
);

alter table public.github_hooks enable row level security;

create policy "github_hooks: read own" on public.github_hooks
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "github_hooks: add own" on public.github_hooks
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "github_hooks: update own" on public.github_hooks
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "github_hooks: remove own" on public.github_hooks
  for delete to authenticated using ((select auth.uid()) = user_id);

-- The secret goes in once and never comes back out to a client; GitHub's hook id is the only thing updated later.
revoke all on public.github_hooks from anon, authenticated;
grant select (id, user_id, repo, github_hook_id, created_at) on public.github_hooks to authenticated;
grant insert (repo, secret) on public.github_hooks to authenticated;
grant update (github_hook_id) on public.github_hooks to authenticated;
grant delete on public.github_hooks to authenticated;

-- What GitHub sent, minus the payload: the repo and issue are all Weft needs to know what to sync. Only the relay
-- writes rows; it clears a hook's rows older than a day as it adds one.
create table public.github_events (
  id bigint generated always as identity primary key,
  hook_id uuid not null references public.github_hooks (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  repo text not null,
  event text not null,
  action text,
  issue_number integer,
  delivery text unique,
  created_at timestamptz not null default now()
);

create index github_events_hook_created on public.github_events (hook_id, created_at);
create index github_events_user on public.github_events (user_id);

alter table public.github_events enable row level security;

create policy "github_events: read own" on public.github_events
  for select to authenticated using ((select auth.uid()) = user_id);

revoke all on public.github_events from anon, authenticated;
grant select on public.github_events to authenticated;

-- Realtime sends each new row to its owner (it applies the select policy above).
alter publication supabase_realtime add table public.github_events;
