-- Mini app share links: one URL (weft.zip/a/<id>) that shows a page saved as a mini app (lib/mini-apps.ts),
-- gated by the same four @aimhuge/share modes as a card's link (20261017130000_card_shares.sql). Mini apps live on
-- the Mac (~/.weft/apps.json), so a share carries its own copy of what to show: a local page the Mac uploaded to
-- weft-blobs (`blob:sha256:<hex>#hash`) or a public site's address. lib/app-share.ts writes it through the signed-in
-- account; the deployed Weft reads it with the service role to check the gate and serve the page
-- (lib/app-share-access.ts, app/a/[id]). docs/architecture/mini-apps.md.

-- One row per shared app, per sharer: app ids are made on one Mac, so they're unique only with created_by.
-- `private` keeps the row (and its id) so opening the app up again reuses the link.
create table public.cloud_app_shares (
  id            text primary key check (id ~ '^[A-Za-z0-9_-]{16,32}$'),
  org_id        uuid not null references public.orgs (id) on delete cascade,
  app_id        text not null check (char_length(app_id) between 1 and 64),
  name          text not null check (char_length(name) between 1 and 80),
  kind          text not null check (kind in ('blob', 'site')),
  page          text not null check (
    (kind = 'blob' and page ~ '^blob:sha256:[0-9a-f]{64}(#.*)?$') or (kind = 'site' and page ~* '^https://')
  ),
  mode          text not null default 'private' check (mode in ('private', 'public', 'email', 'password')),
  password_hash text,
  has_password  boolean generated always as (password_hash is not null) stored,
  created_by    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (org_id, created_by, app_id)
);

create trigger cloud_app_shares_touch_updated_at
  before update on public.cloud_app_shares
  for each row execute function private.touch_updated_at();

-- Who got through an app link's email gate. Only the deployed Weft writes these (service role).
create table public.cloud_app_share_visits (
  share_id text not null references public.cloud_app_shares (id) on delete cascade,
  email    text,
  at       timestamptz not null default now()
);

create index cloud_app_share_visits_by_share
  on public.cloud_app_share_visits (share_id, at desc);

alter table public.cloud_app_shares       enable row level security;
alter table public.cloud_app_share_visits enable row level security;

revoke all on public.cloud_app_shares, public.cloud_app_share_visits from anon, authenticated;

-- Members see the workspace's shared apps and how they're shared, never the password hash (left out of the grant).
create policy "cloud_app_shares: read as member" on public.cloud_app_shares
  for select to authenticated using (private.is_org_member(org_id));
grant select (id, org_id, app_id, name, kind, page, mode, has_password, created_by, created_at, updated_at)
  on public.cloud_app_shares to authenticated;

-- Only the sharer writes their own rows, and only into a workspace they belong to. created_by isn't in the insert
-- or update grants, so the database fills it with auth.uid() and a client can't claim someone else's app.
create policy "cloud_app_shares: insert own" on public.cloud_app_shares
  for insert to authenticated with check (created_by = (select auth.uid()) and private.is_org_member(org_id));
create policy "cloud_app_shares: update own" on public.cloud_app_shares
  for update to authenticated using (created_by = (select auth.uid()))
  with check (created_by = (select auth.uid()) and private.is_org_member(org_id));
create policy "cloud_app_shares: delete own" on public.cloud_app_shares
  for delete to authenticated using (created_by = (select auth.uid()));
grant insert (id, org_id, app_id, name, kind, page, mode, password_hash) on public.cloud_app_shares to authenticated;
grant update (name, kind, page, mode, password_hash) on public.cloud_app_shares to authenticated;
grant delete on public.cloud_app_shares to authenticated;

-- Visits hold viewers' emails, so only the app's sharer reads them.
create policy "cloud_app_share_visits: read as sharer" on public.cloud_app_share_visits
  for select to authenticated using (
    exists (select 1 from public.cloud_app_shares s where s.id = share_id and s.created_by = (select auth.uid()))
  );
grant select on public.cloud_app_share_visits to authenticated;

-- Neither table joins supabase_realtime: the viewer reads through the deployed Weft with the service role.
