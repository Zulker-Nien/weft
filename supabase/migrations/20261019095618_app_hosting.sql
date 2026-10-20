-- React mini apps hosted on weft.zip (docs/architecture/mini-app-hosting.md): an app link lives under its owner,
-- weft.zip/@username/apps/<slug> or weft.zip/<org-slug>/apps/<slug>, serves a whole folder of files, and reaches
-- other services only through Weft's fetch route, which puts encrypted secrets in by reference.

-- Who the link lives under, its slug there, the folder's files and the app's policy (weft-app.json's secrets and
-- public names). `owner = 'user'` reads its username from created_by's profile; `owner = 'org'` uses org_id's slug.
alter table public.cloud_app_shares
  add column owner    text not null default 'user' check (owner in ('user', 'org')),
  add column slug     text check (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$'),
  add column files    jsonb check (files is null or jsonb_typeof(files) = 'object'),
  add column manifest jsonb check (manifest is null or jsonb_typeof(manifest) = 'object');

-- A folder app: `files` maps each relative path to the sha256 of its blob in weft-blobs/<org>/<sha>, and `page` is
-- the entry file's path among them (index.html). No absolute paths and no `..`, so a path can't climb out.
alter table public.cloud_app_shares drop constraint cloud_app_shares_kind_check;
alter table public.cloud_app_shares add constraint cloud_app_shares_kind_check check (kind in ('blob', 'site', 'folder'));
alter table public.cloud_app_shares drop constraint cloud_app_shares_check;
alter table public.cloud_app_shares add constraint cloud_app_shares_page_check check (
  (kind = 'blob' and page ~ '^blob:sha256:[0-9a-f]{64}(#.*)?$')
  or (kind = 'site' and page ~* '^https://')
  or (kind = 'folder' and files is not null and page ~ '^[A-Za-z0-9._-][A-Za-z0-9._/-]*$' and page !~ '\.\.')
);

-- One slug per owner: per sharer under @username, per workspace under its slug.
create unique index cloud_app_shares_user_slug on public.cloud_app_shares (created_by, slug)
  where owner = 'user' and slug is not null;
create unique index cloud_app_shares_org_slug on public.cloud_app_shares (org_id, slug)
  where owner = 'org' and slug is not null;

grant select (owner, slug, files, manifest) on public.cloud_app_shares to authenticated;
grant insert (owner, slug, files, manifest) on public.cloud_app_shares to authenticated;
grant update (owner, slug, files, manifest) on public.cloud_app_shares to authenticated;

-- An app's secrets, by name: the author's (viewer_id null) or one viewer's own (`"from": "viewer"`). The value is
-- AES-256-GCM ciphertext under WEFT_MINIAPP_KEY, a key only weft.zip's server env holds, with share_id|name|viewer as
-- associated data so a row copied to another app or name won't decrypt (lib/app-secrets.ts). No client may read or
-- write it: RLS on, no policies, no grants; only weft.zip's routes reach it through the service role.
create table public.cloud_app_secrets (
  share_id   text not null references public.cloud_app_shares (id) on delete cascade,
  name       text not null check (name ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  viewer_id  uuid references auth.users (id) on delete cascade,
  ciphertext text not null check (char_length(ciphertext) between 1 and 65536),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index cloud_app_secrets_key
  on public.cloud_app_secrets (share_id, name, coalesce(viewer_id, '00000000-0000-0000-0000-000000000000'::uuid));
create trigger cloud_app_secrets_touch_updated_at
  before update on public.cloud_app_secrets
  for each row execute function private.touch_updated_at();
alter table public.cloud_app_secrets enable row level security;
revoke all on public.cloud_app_secrets from anon, authenticated;

-- Each call an app makes through weft.zip's fetch route: host, path and status, never a value. The route counts the
-- last minute's rows for its rate limit, and the app's owner can see where its keys went.
create table public.cloud_app_fetches (
  share_id  text not null references public.cloud_app_shares (id) on delete cascade,
  viewer_id uuid references auth.users (id) on delete set null,
  method    text not null check (char_length(method) between 1 and 10),
  host      text not null check (char_length(host) between 1 and 255),
  path      text not null check (char_length(path) between 1 and 2048),
  status    integer not null,
  at        timestamptz not null default now()
);
create index cloud_app_fetches_by_share on public.cloud_app_fetches (share_id, at desc);
alter table public.cloud_app_fetches enable row level security;
revoke all on public.cloud_app_fetches from anon, authenticated;
create policy "cloud_app_fetches: read as sharer" on public.cloud_app_fetches
  for select to authenticated using (
    exists (select 1 from public.cloud_app_shares s where s.id = share_id and s.created_by = (select auth.uid()))
  );
grant select on public.cloud_app_fetches to authenticated;
