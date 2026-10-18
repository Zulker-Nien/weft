-- A rate limit for POST /api/s/[id]/unlock (lib/share-gate + app/api/s/[id]/unlock/route.ts). The route
-- is public (no auth gate) and the password gate it protects is the only thing stopping a brute force,
-- so the limit has to live on a row anyone can write to from the deployed Weft's service role but no
-- one can read or write through the API. A per-(ip_hash, share_id) row count, kept by service_role
-- alone, is the simplest shape that doesn't reset on a Vercel redeploy. ip_hash (sha-256 of the
-- client's IP + a per-deployment pepper) keeps the row from leaking viewer IPs at rest and makes the
-- bucket unguessable from a known IP.
--
-- docs/architecture/sharing.md documents the deploy-only secret SHARE_UNLOCK_PEPPER and the 10/10min
-- budget. A misconfigured deployment (no SUPABASE_SECRET_KEY) has no rate limit at all — the route
-- answers 503 first, so this never reaches the table.

create table public.share_unlock_attempts (
  -- sha-256(ip || SHARE_UNLOCK_PEPPER), so two deployments don't share a bucket space.
  ip_hash   text not null,
  -- The share's id, so an attacker banging on one link doesn't lock every other link out.
  share_id  text not null,
  -- Total attempts in the current window. Reset to 0 when the row's first attempt ages out.
  count     integer not null default 0,
  -- The earliest attempt in the current window; adding more bumps `count` and, past the window,
  -- the service role rolls it forward.
  first_at  timestamptz not null default now(),
  primary key (ip_hash, share_id)
);

create index share_unlock_attempts_first_at
  on public.share_unlock_attempts (first_at);

alter table public.share_unlock_attempts enable row level security;

-- Only the service role reads and writes this; anon and authenticated have no grant, so the API never
-- touches the table directly. The route is a service-role caller too, so this is belt-and-braces.
revoke all on public.share_unlock_attempts from anon, authenticated;
