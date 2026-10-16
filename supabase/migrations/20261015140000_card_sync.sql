-- Server-side cards: the rows Weft uploads to Supabase so the same card opens on another Mac in the same
-- workspace. lib/cloud-sync-types.ts is the type contract, lib/cloud-sync.ts is the outbox that turns bus events
-- into rows, lib/blob-store.ts swaps local paths for content hashes, and this migration holds the tables.
-- Sync is opt-in per folder (settings `syncFolders`) and off by default; the Mac running a card OWNS it
-- (owner_user = auth.uid()), other devices only read. docs/architecture/cloud-sync.md.

-- One row per synced card, upserted on every change. owner_user is the account that runs the card and the
-- only one that may write it; owner_device is which of that account's Macs runs it (lib/device-id.ts). Everyone
-- else in the org reads it through the select policy, so they can follow along and queue replies.
create table public.cloud_cards (
  org_id       uuid not null references public.orgs (id) on delete cascade,
  card_id      text not null,
  owner_device text not null,
  owner_user   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  folder       text not null,
  card         jsonb not null,
  deleted      boolean not null default false,
  updated_at   timestamptz not null default now(),
  primary key (org_id, card_id)
);

-- A card's thread items, paged newest first by the index route (lib/cloud-sync.ts). item is the ThreadItem
-- with long tool results cut out (TOOL_RESULT_INLINE_MAX) and local paths rewritten to blob refs
-- (lib/blob-store.ts). The full result for any cut tool sits in cloud_tool_outputs and is fetched when the
-- row is opened.
create table public.cloud_thread_items (
  org_id  uuid not null,
  card_id text not null,
  seq     int  not null,
  kind    text not null,
  item    jsonb not null,
  at      timestamptz not null,
  primary key (org_id, card_id, seq),
  foreign key (org_id, card_id) references public.cloud_cards (org_id, card_id) on delete cascade
);

create index cloud_thread_items_card_seq_desc
  on public.cloud_thread_items (org_id, card_id, seq desc);

-- The full result of a tool call whose body was cut out of its item, fetched by another device when the
-- row is opened (on the owning Mac, /api/cards/[id]/thread/tool/[toolId] reads the local thread instead).
-- bytes is the result's length, so a client can show "12 KB" without downloading it.
create table public.cloud_tool_outputs (
  org_id  uuid not null,
  card_id text not null,
  tool_id text not null,
  result  text not null,
  bytes   int  not null,
  primary key (org_id, card_id, tool_id),
  foreign key (org_id, card_id) references public.cloud_cards (org_id, card_id) on delete cascade
);

create trigger cloud_cards_touch_updated_at
  before update on public.cloud_cards
  for each row execute function private.touch_updated_at();

alter table public.cloud_cards      enable row level security;
alter table public.cloud_thread_items enable row level security;
alter table public.cloud_tool_outputs enable row level security;

-- Membership and ownership helpers, in private like the others (teams_rls.sql). is_org_member already
-- exists; is_card_owner is new and runs as its owner (security definer) so a policy on cloud_thread_items
-- or cloud_tool_outputs can ask "does the caller own this card?" without recursing through the items'
-- own policies or hitting cloud_cards' policy at row-read time.
create or replace function private.is_card_owner(org uuid, card text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.cloud_cards c
    where c.org_id = org and c.card_id = card and c.owner_user = (select auth.uid())
  );
$$;

grant execute on function private.is_card_owner(uuid, text) to authenticated;
revoke all on function private.is_card_owner(uuid, text) from public, anon;

-- Take back the table grants Supabase adds by default before we open just the ones the policies need, so a
-- future policy change can't quietly widen a column grant (like owner_device, or the jsonb body) to a role.
revoke all on public.cloud_cards, public.cloud_thread_items, public.cloud_tool_outputs
  from anon, authenticated;

-- Members of the org can read all three tables. A card that was opened on one Mac is visible to the rest
-- of the workspace; the owner_user check is on writes only.
create policy "cloud_cards: read as member" on public.cloud_cards
  for select to authenticated using (private.is_org_member(org_id));
grant select on public.cloud_cards to authenticated;

create policy "cloud_thread_items: read as member" on public.cloud_thread_items
  for select to authenticated using (private.is_org_member(org_id));
grant select on public.cloud_thread_items to authenticated;

create policy "cloud_tool_outputs: read as member" on public.cloud_tool_outputs
  for select to authenticated using (private.is_org_member(org_id));
grant select on public.cloud_tool_outputs to authenticated;

-- Only the Mac running the card may write its rows: insert/update/delete go through the outbox on that
-- Mac, and the outbox sends as the card's owner_user. Items and outputs check ownership through
-- cloud_cards via the helper above, so a teammate's items can't be overwritten.
create policy "cloud_cards: write own" on public.cloud_cards
  for insert to authenticated with check ((select auth.uid()) = owner_user);
create policy "cloud_cards: update own" on public.cloud_cards
  for update to authenticated using ((select auth.uid()) = owner_user)
  with check ((select auth.uid()) = owner_user);
create policy "cloud_cards: delete own" on public.cloud_cards
  for delete to authenticated using ((select auth.uid()) = owner_user);
grant insert, update, delete on public.cloud_cards to authenticated;

create policy "cloud_thread_items: write own card" on public.cloud_thread_items
  for insert to authenticated with check (private.is_card_owner(org_id, card_id));
create policy "cloud_thread_items: update own card" on public.cloud_thread_items
  for update to authenticated using (private.is_card_owner(org_id, card_id))
  with check (private.is_card_owner(org_id, card_id));
create policy "cloud_thread_items: delete own card" on public.cloud_thread_items
  for delete to authenticated using (private.is_card_owner(org_id, card_id));
grant insert, update, delete on public.cloud_thread_items to authenticated;

create policy "cloud_tool_outputs: write own card" on public.cloud_tool_outputs
  for insert to authenticated with check (private.is_card_owner(org_id, card_id));
create policy "cloud_tool_outputs: update own card" on public.cloud_tool_outputs
  for update to authenticated using (private.is_card_owner(org_id, card_id))
  with check (private.is_card_owner(org_id, card_id));
create policy "cloud_tool_outputs: delete own card" on public.cloud_tool_outputs
  for delete to authenticated using (private.is_card_owner(org_id, card_id));
grant insert, update, delete on public.cloud_tool_outputs to authenticated;

-- ─── Storage bucket: weft-blobs ─────────────────────────────────────────────
-- Images, attachments and ~/.weft/show pages, stored once each by content. The path is
-- '<org_id>/<sha256>': a content hash means the same file uploaded by two Mac's lands at the same key
-- (deduplication), and the org prefix is the only access check (no per-file ACLs). Members of the org
-- may read and insert; no update or delete by clients — a blob's content is its identity, and the outbox
-- keeps a row in cloud_cards or a thread item alive for as long as anyone still references the ref.

insert into storage.buckets (id, name, public)
  values ('weft-blobs', 'weft-blobs', false)
  on conflict (id) do nothing;

-- Folder name on storage is the first segment of the path; Weft's path is '<org_id>/<sha256>'.
create policy "weft-blobs: read as org member" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'weft-blobs'
    and private.is_org_member((storage.foldername(name))[1]::uuid)
  );
create policy "weft-blobs: insert as org member" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'weft-blobs'
    and private.is_org_member((storage.foldername(name))[1]::uuid)
  );

-- ─── Realtime ───────────────────────────────────────────────────────────────
-- Realtime sends each new or updated card and item to the workspace's other devices, filtered by the select
-- policies above. cloud_tool_outputs stays off it: outputs are big and fetched only when a row is opened.
alter publication supabase_realtime add table public.cloud_cards;
alter publication supabase_realtime add table public.cloud_thread_items;
