-- Commands the web board sends to a Mac: "start this card in that folder". weft.zip can't run a thread, so a
-- card made there is a row here; the Mac it names (cloud_cards.owner_device) hears it over Realtime, claims it,
-- creates the card in a folder that is synced and starts the thread, and the card then comes back through
-- cloud_cards like any other. lib/cloud-commands.ts is the contract, lib/cloud-inbox.ts the Mac's side,
-- docs/architecture/cloud-sync.md the story.
--
-- The Mac only acts on a command its own account created (created_by) for its own device and a folder the user
-- switched on in Settings → Sync, so these policies decide who may write and read, not who may be obeyed.

create table public.cloud_commands (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs (id) on delete cascade,
  created_by    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind          text not null check (kind in ('new_card')),
  -- Which Mac runs it (lib/device-id.ts) and in which of its folders.
  target_device text not null,
  folder        text not null,
  -- new_card: { prompt, title?, backend?, model?, effort?, tags? }
  payload       jsonb not null check (octet_length(payload::text) <= 200000),
  status        text not null default 'pending' check (status in ('pending', 'claimed', 'done', 'failed')),
  -- The card the Mac made, once it has; error says why a command failed.
  card_id       text,
  error         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index cloud_commands_target_pending
  on public.cloud_commands (target_device, created_at)
  where status = 'pending';
create index cloud_commands_org_created
  on public.cloud_commands (org_id, created_at desc);

create trigger cloud_commands_touch_updated_at
  before update on public.cloud_commands
  for each row execute function private.touch_updated_at();

alter table public.cloud_commands enable row level security;

revoke all on public.cloud_commands from anon, authenticated;

-- The workspace sees a command (the web board shows "waiting for your Mac"); only its author writes it.
create policy "cloud_commands: read as member" on public.cloud_commands
  for select to authenticated using (private.is_org_member(org_id));
grant select on public.cloud_commands to authenticated;

-- Insert: a member, as themselves, and a fresh command (pending, no card yet). Only these columns are
-- grantable, so a client can't set its own status, card or error on the way in.
create policy "cloud_commands: insert as member" on public.cloud_commands
  for insert to authenticated
  with check (private.is_org_member(org_id) and (select auth.uid()) = created_by);
grant insert (org_id, kind, target_device, folder, payload) on public.cloud_commands to authenticated;

-- Update: the author's Mac claims it and reports back with the author's own session, so status, card and
-- error are the only columns a client can change.
create policy "cloud_commands: update own" on public.cloud_commands
  for update to authenticated
  using ((select auth.uid()) = created_by)
  with check ((select auth.uid()) = created_by);
grant update (status, card_id, error) on public.cloud_commands to authenticated;

-- Delete: the author cancels a command that hasn't been picked up, or clears a finished one.
create policy "cloud_commands: delete own" on public.cloud_commands
  for delete to authenticated using ((select auth.uid()) = created_by);
grant delete on public.cloud_commands to authenticated;

-- The Mac hears a command the moment the web posts it, and the web hears it claimed and done.
alter publication supabase_realtime add table public.cloud_commands;
