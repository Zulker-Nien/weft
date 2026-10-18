-- Mini apps persisted on prod (lib/app-cloud.ts, docs/architecture/mini-apps.md): one row per app, per account.
-- A site is its URL; a file/folder is its index.html uploaded to weft-blobs (`blob:sha256:<hex>`) and for a folder also
-- the weft-app.json manifest. The position column is the rail order; deleted rows are tombstones so a pull never brings
-- a removed app back. A manifest names a local folder, so a row is its owner's alone.

create table public.cloud_mini_apps (
  app_id        text not null check (char_length(app_id) between 1 and 64),
  org_id        uuid not null references public.orgs (id) on delete cascade,
  name          text not null check (char_length(name) between 1 and 80),
  url           text not null check (char_length(url) between 1 and 2048),
  kind          text not null check (kind in ('site', 'file', 'folder')),
  page          text check (
    (kind in ('file', 'folder') and page ~ '^blob:sha256:[0-9a-f]{64}$')
    or (kind = 'site' and page is null)
  ),
  manifest      jsonb check (
    (kind = 'folder' and jsonb_typeof(manifest) = 'object')
    or (kind <> 'folder' and manifest is null)
  ) check (manifest is null or pg_column_size(manifest) <= 65536),
  position      int  not null,
  deleted       boolean not null default false,
  created_by    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (created_by, app_id)
);

create index cloud_mini_apps_by_org
  on public.cloud_mini_apps (org_id, created_by, position);

create trigger cloud_mini_apps_touch_updated_at
  before update on public.cloud_mini_apps
  for each row execute function private.touch_updated_at();

alter table public.cloud_mini_apps enable row level security;

revoke all on public.cloud_mini_apps from anon, authenticated;

-- Only the owner reads their own rows.
create policy "cloud_mini_apps: read own" on public.cloud_mini_apps
  for select to authenticated using (created_by = (select auth.uid()));
grant select (app_id, org_id, name, url, kind, page, manifest, position, deleted, created_by, created_at, updated_at)
  on public.cloud_mini_apps to authenticated;

-- Insert/update/delete are the owner's alone, and only into a workspace they belong to. created_by is left out of
-- the insert/update grants so the database fills it with auth.uid() and a client can't claim someone else's app.
create policy "cloud_mini_apps: insert own" on public.cloud_mini_apps
  for insert to authenticated with check (created_by = (select auth.uid()) and private.is_org_member(org_id));
create policy "cloud_mini_apps: update own" on public.cloud_mini_apps
  for update to authenticated using (created_by = (select auth.uid()))
  with check (created_by = (select auth.uid()) and private.is_org_member(org_id));
create policy "cloud_mini_apps: delete own" on public.cloud_mini_apps
  for delete to authenticated using (created_by = (select auth.uid()));
grant insert (app_id, org_id, name, url, kind, page, manifest, position) on public.cloud_mini_apps to authenticated;
grant update (org_id, name, url, kind, page, manifest, position, deleted) on public.cloud_mini_apps to authenticated;
grant delete on public.cloud_mini_apps to authenticated;

-- No Realtime subscription: the Mac reads through lib/app-cloud.ts on a 5-minute pull, not a channel.
