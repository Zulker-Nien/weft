-- Teams own projects: a team has many GitHub repos ("owner/name"). Same access model as org_memberships: RLS on with
-- no policies, so only the service client (lib/team-projects.ts on the deployed Weft) reads or writes it.
create table public.org_projects (
  org_id     uuid not null references public.orgs (id) on delete cascade,
  repo       text not null check (repo ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'),
  added_by   uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (org_id, repo)
);

alter table public.org_projects enable row level security;
revoke all on public.org_projects from anon, authenticated;
