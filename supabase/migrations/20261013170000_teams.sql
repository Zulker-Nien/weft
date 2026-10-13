-- Weft teams: workspaces (orgs), who's in them (org_memberships) and email invites (invitations), the schema
-- @aimhuge/teams reads and writes (its src/sql/0001 and 0002). Weft keeps its own copy instead of running the
-- package's files because 0001 replaces on_auth_user_created, which would drop the name and avatar our sign-up
-- trigger fills in (20261011165940_profiles.sql). docs/architecture/teams.md.
--
-- Access is enforced in app code on the deployed Weft: requireOrg gates every /[orgSlug]/… page and every read
-- goes through the service client. RLS is on with no policies, so the publishable key reads nothing here.

create table public.orgs (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique,
  name       text not null,
  -- The package's schema has it for the BlastCP approval flow; unused in Weft, kept so the package's reads match.
  require_post_approval boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.org_memberships (
  org_id     uuid not null references public.orgs (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       text not null default 'member' check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index org_memberships_user_idx on public.org_memberships (user_id);

create trigger orgs_touch_updated_at
  before update on public.orgs
  for each row execute function private.touch_updated_at();

-- Pending email invites. The token is the capability: opening /invite/<token> signed in (with any address)
-- joins the workspace; accepted_email records who actually took it.
create table public.invitations (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.orgs (id) on delete cascade,
  invited_email    text not null,
  role             text not null default 'member' check (role in ('owner', 'admin', 'member')),
  invite_token     text not null,
  invited_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null default (now() + interval '14 days'),
  accepted_at      timestamptz,
  accepted_user_id uuid references auth.users (id) on delete set null,
  accepted_email   text,
  revoked_at       timestamptz
);
create unique index invitations_token_active_idx on public.invitations (invite_token)
  where accepted_at is null and revoked_at is null;
create index invitations_org_pending_idx on public.invitations (org_id, created_at desc)
  where accepted_at is null and revoked_at is null;
create index invitations_email_lookup_idx on public.invitations (lower(invited_email));

alter table public.orgs enable row level security;
alter table public.org_memberships enable row level security;
alter table public.invitations enable row level security;
revoke all on public.orgs, public.org_memberships, public.invitations from anon, authenticated;

-- What the package reads from profiles: the active-workspace pointer, the roster's display_name (Weft calls it
-- name) and last sign-in (written by /auth/callback on weft.zip).
alter table public.profiles
  add column current_org_id uuid references public.orgs (id) on delete set null,
  add column display_name text generated always as (name) stored,
  add column last_login_at timestamptz,
  add column login_count integer not null default 0;

-- Every account has a workspace from its first sign-in: solo is a team of one, and billing and the shared vault
-- both hang off orgs.id. Its slug comes from the GitHub login (or the email's local part), shaped like the
-- package's slugify(), skipping @aimhuge/teams' RESERVED_SLUGS plus Weft's root routes, with -2, -3… on a clash.
create or replace function private.org_slug_for(seed text)
returns text
language plpgsql
set search_path = ''
as $$
declare
  base text := left(trim(both '-' from regexp_replace(lower(coalesce(seed, '')), '[^a-z0-9]+', '-', 'g')), 40);
  candidate text;
  n int := 1;
  reserved text[] := array[
    'api', 'auth', 'claim', 'clients', 'dashboard', 'decks', 'feedback', 'internal', 'leads', 'login', 'logout',
    'pricing', 'settings', 'signup', 'skills', 'support', 'team', 'teams', 'tokens', 'workspace', 'workspaces',
    'about', 'account', 'admin', 'analytics', 'app', 'billing', 'blog', 'calendar', 'channels', 'contact', 'docs',
    'help', 'home', 'i', 'new', 'o', 'org', 'orgs', 'posts', 'schedule', 'status', 'unsubscribe', 'assets', 'cdn',
    'mail', 'public', 'static', 'www', 'icon', 'opengraph-image',
    -- Weft's own root routes.
    'copilot', 'invite', 'vault', 'download'];
begin
  if base = '' then base := 'workspace'; end if;
  candidate := base;
  while length(candidate) < 2 or candidate = any(reserved) or exists (select 1 from public.orgs o where o.slug = candidate) loop
    n := n + 1;
    candidate := base || '-' || n;
  end loop;
  return candidate;
end;
$$;

create or replace function private.create_personal_org(uid uuid, login text, label text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_org uuid;
begin
  if exists (select 1 from public.org_memberships m where m.user_id = uid) then return null; end if;
  insert into public.orgs (slug, name)
    values (private.org_slug_for(login), coalesce(nullif(label, ''), login, 'My workspace'))
    returning id into new_org;
  insert into public.org_memberships (org_id, user_id, role) values (new_org, uid, 'owner');
  update public.profiles set current_org_id = new_org where id = uid;
  return new_org;
end;
$$;

create or replace function private.handle_new_user_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.create_personal_org(
    new.id,
    coalesce(new.raw_user_meta_data ->> 'user_name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', new.raw_user_meta_data ->> 'user_name')
  );
  return new;
end;
$$;

revoke all on function private.org_slug_for(text) from public, anon, authenticated;
revoke all on function private.create_personal_org(uuid, text, text) from public, anon, authenticated;
revoke all on function private.handle_new_user_org() from public, anon, authenticated;

-- Named so it sorts after on_auth_user_created: triggers fire in name order, and the profile row must exist first.
create trigger on_auth_user_created_workspace
  after insert on auth.users
  for each row execute function private.handle_new_user_org();

-- Backfill: a workspace for every account made before this migration.
select private.create_personal_org(
  u.id,
  coalesce(u.raw_user_meta_data ->> 'user_name', split_part(u.email, '@', 1)),
  coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', u.raw_user_meta_data ->> 'user_name')
)
from auth.users u
order by u.created_at;
