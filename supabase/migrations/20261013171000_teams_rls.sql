-- Row-level security for Weft teams (20261013170000_teams.sql): who may READ workspaces, memberships, invites and
-- teammates' profiles with their own session (the publishable key plus their JWT). Writes stay with the deployed
-- Weft's service role (lib/team-ops.ts), which enforces what a policy can't say cleanly: assignable roles, never
-- leaving a workspace without an owner, invites sent by email. docs/architecture/teams.md.

-- Membership checks run as their owner (security definer), so a policy on org_memberships doesn't recurse into
-- org_memberships' own policy. They answer only about the caller (auth.uid()), never about anyone else.
create or replace function private.is_org_member(org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.org_memberships m where m.org_id = org and m.user_id = (select auth.uid())
  );
$$;

create or replace function private.org_role(org uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select m.role from public.org_memberships m where m.org_id = org and m.user_id = (select auth.uid());
$$;

-- True when the caller and `other` are in at least one workspace together (the roster shows teammates' names).
create or replace function private.shares_org(other uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.org_memberships mine
    join public.org_memberships theirs on theirs.org_id = mine.org_id
    where mine.user_id = (select auth.uid()) and theirs.user_id = other
  );
$$;

-- Policies call these as the signed-in user, so `authenticated` needs to reach them, and nothing else in `private`.
grant usage on schema private to authenticated;
revoke all on function private.is_org_member(uuid), private.org_role(uuid), private.shares_org(uuid) from public, anon;
grant execute on function private.is_org_member(uuid), private.org_role(uuid), private.shares_org(uuid) to authenticated;

-- Workspaces: you see the ones you belong to.
create policy "orgs: read as member" on public.orgs
  for select to authenticated using (private.is_org_member(id));
grant select on public.orgs to authenticated;

-- Memberships: you see everyone in a workspace you belong to (the roster).
create policy "org_memberships: read as member" on public.org_memberships
  for select to authenticated using (private.is_org_member(org_id));
grant select on public.org_memberships to authenticated;

-- Pending invites: owners and admins see their workspace's. The token is the invite itself (it joins whoever
-- opens the link), so it's never readable from a client, only by the service role that mails it.
create policy "invitations: read as owner or admin" on public.invitations
  for select to authenticated using (private.org_role(org_id) in ('owner', 'admin'));
grant select (id, org_id, invited_email, role, invited_by, created_at, expires_at, accepted_at, accepted_user_id,
  accepted_email, revoked_at) on public.invitations to authenticated;

-- Profiles: besides your own ("profiles: read own"), the people you share a workspace with.
create policy "profiles: read teammates" on public.profiles
  for select to authenticated using (private.shares_org(id));
