-- Card share links: one URL (weft.zip/s/<id>) that shows a card's thread and the page its browser pane shows,
-- gated by one of four modes from @aimhuge/share. lib/share-types.ts is the type contract (CloudShareRow,
-- CloudShareVisitRow). The card's thread and pane are the rows cloud sync already uploads
-- (20261015140000_card_sync.sql), so a share is only ever a pointer at a synced card plus its gate.
-- The desktop writes a share through the signed-in account; the deployed Weft reads it with the service role
-- to check the gate and serve the viewer, so nothing here is readable by anon. docs/architecture/sharing.md.

-- One row per shared card. `private` keeps the row (and its id) so re-opening the link later reuses it.
-- password_hash is the scrypt hash from @aimhuge/share/server; has_password is derived from it so a client
-- can tell a password is set without ever reading the hash.
create table public.cloud_shares (
  id            text primary key check (id ~ '^[A-Za-z0-9_-]{16,32}$'),
  org_id        uuid not null,
  card_id       text not null,
  mode          text not null default 'private' check (mode in ('private', 'public', 'email', 'password')),
  password_hash text,
  has_password  boolean generated always as (password_hash is not null) stored,
  created_by    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (org_id, card_id),
  -- A share dies with its card: deleting the cloud_cards row (or the workspace behind it) drops the link.
  foreign key (org_id, card_id) references public.cloud_cards (org_id, card_id) on delete cascade
);

create trigger cloud_shares_touch_updated_at
  before update on public.cloud_shares
  for each row execute function private.touch_updated_at();

-- Who got through an email gate, and when anyone opened a link. Only the deployed Weft writes these (service
-- role, after it checked the gate), so a visitor can't forge or wipe their own trail.
create table public.cloud_share_visits (
  share_id text not null references public.cloud_shares (id) on delete cascade,
  email    text,
  at       timestamptz not null default now()
);

create index cloud_share_visits_share_at_desc
  on public.cloud_share_visits (share_id, at desc);

alter table public.cloud_shares       enable row level security;
alter table public.cloud_share_visits enable row level security;

-- Take back the table grants Supabase adds by default, then open only the columns each role needs. The
-- grants are per column on purpose: a policy decides which rows, the grant decides which columns.
revoke all on public.cloud_shares, public.cloud_share_visits from anon, authenticated;

-- Members of the org can see that a card is shared and how (the Share dialog on any of the workspace's
-- Macs), but never the password hash: it's left out of the column grant, so `select *` or
-- `select password_hash` fails for authenticated. has_password answers "is one set?" instead.
create policy "cloud_shares: read as member" on public.cloud_shares
  for select to authenticated using (private.is_org_member(org_id));
grant select (id, org_id, card_id, mode, has_password, created_by, created_at, updated_at)
  on public.cloud_shares to authenticated;

-- Only the card's owner (the account whose Mac runs it, cloud_cards.owner_user) may share it, change the
-- mode or password, or take the link down. created_by is left out of the insert and update grants, so the
-- database fills it with auth.uid() and a client can't claim someone else made the link; has_password is
-- generated, and created_at/updated_at come from the default and the trigger.
create policy "cloud_shares: write own card" on public.cloud_shares
  for insert to authenticated with check (private.is_card_owner(org_id, card_id));
create policy "cloud_shares: update own card" on public.cloud_shares
  for update to authenticated using (private.is_card_owner(org_id, card_id))
  with check (private.is_card_owner(org_id, card_id));
create policy "cloud_shares: delete own card" on public.cloud_shares
  for delete to authenticated using (private.is_card_owner(org_id, card_id));
grant insert (id, org_id, card_id, mode, password_hash) on public.cloud_shares to authenticated;
grant update (id, org_id, card_id, mode, password_hash) on public.cloud_shares to authenticated;
grant delete on public.cloud_shares to authenticated;

-- Visits hold viewers' emails, so only the shared card's owner sees them, not the rest of the workspace.
-- The lookup goes through cloud_shares (readable by the owner as a member) to the card's ownership helper.
-- No insert, update or delete grant: the service role writes them and bypasses RLS.
create policy "cloud_share_visits: read as card owner" on public.cloud_share_visits
  for select to authenticated using (
    exists (
      select 1 from public.cloud_shares s
      where s.id = share_id and private.is_card_owner(s.org_id, s.card_id)
    )
  );
grant select on public.cloud_share_visits to authenticated;

-- ─── Realtime ───────────────────────────────────────────────────────────────
-- Neither table joins supabase_realtime: the viewer polls the deployed Weft (SHARE_POLL_MS), which reads
-- with the service role, and a Realtime feed of shares would hand mode changes to every member's socket.
