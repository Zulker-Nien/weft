-- Growth's reads: the Postgres functions the 📈 Growth data mini app calls (docs/architecture/mini-apps.md, "Data apps").
-- Electron main calls them through PostgREST (`GET /rest/v1/rpc/<fn>`, a read-only transaction) with the production SUPABASE_SECRET_KEY, after
-- you grant the app that env with Touch ID. They count across every account, so they are for the service role only:
-- functions get EXECUTE for PUBLIC by default and Supabase grants anon and authenticated on new public functions, so
-- each one is revoked from all three and granted to service_role alone. A signed-in key can't call them.
--
-- Parameter names are what the manifest's args are called (`{ "days": 30 }`), since PostgREST matches args by name.
-- An account is active on a day when it has synced thread items that day, used the Puku trial, or signed in.

-- The days each account was active since a time. Called only from the functions below (as their owner), never directly.
create or replace function private.growth_activity(since timestamptz)
returns table (user_id uuid, day date)
language sql
stable
security definer
set search_path = ''
as $$
  -- Items of a card deleted since still count: the work happened.
  select c.owner_user, (i.at at time zone 'UTC')::date
    from public.cloud_thread_items i
    join public.cloud_cards c on c.org_id = i.org_id and c.card_id = i.card_id
   where i.at >= since and c.owner_user is not null
  union
  select t.user_id, t.day
    from public.puku_trial_usage t
   where t.requests > 0 and t.day >= (since at time zone 'UTC')::date
  union
  -- Supabase Auth keeps only the last sign-in, and Weft's profile its own last login: each is one active day.
  select u.id, (u.last_sign_in_at at time zone 'UTC')::date from auth.users u where u.last_sign_in_at >= since
  union
  select p.id, (p.last_login_at at time zone 'UTC')::date from public.profiles p where p.last_login_at >= since;
$$;

revoke all on function private.growth_activity(timestamptz) from public, anon, authenticated;

-- The headline numbers. Accounts are auth.users; a profile's last_login_at isn't always written, so the later of the
-- two sign-in times counts.
create or replace function public.growth_overview()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with accounts as (
    select u.created_at, greatest(u.last_sign_in_at, p.last_login_at) as last_in
      from auth.users u
      left join public.profiles p on p.id = u.id
  )
  select jsonb_build_object(
    'accounts',          (select count(*) from accounts),
    'new_7d',            (select count(*) from accounts where created_at >= now() - interval '7 days'),
    'new_30d',           (select count(*) from accounts where created_at >= now() - interval '30 days'),
    'signed_in_7d',      (select count(*) from accounts where last_in >= now() - interval '7 days'),
    'signed_in_30d',     (select count(*) from accounts where last_in >= now() - interval '30 days'),
    'never_signed_in',   (select count(*) from accounts where last_in is null),
    'workspaces',        (select count(*) from public.orgs),
    'invites_pending',   (select count(*) from public.invitations
                           where accepted_at is null and revoked_at is null and (expires_at is null or expires_at > now())),
    'syncing_accounts',  (select count(distinct owner_user) from public.cloud_cards where not deleted),
    'synced_cards',      (select count(*) from public.cloud_cards where not deleted),
    'sharers',           (select count(distinct created_by) from public.cloud_shares),
    'share_links',       (select count(*) from public.cloud_shares),
    'share_visits',      (select count(*) from public.cloud_share_visits),
    'trial_accounts',    (select count(distinct user_id) from public.puku_trial_usage where requests > 0),
    'trial_requests',    (select coalesce(sum(requests), 0) from public.puku_trial_usage),
    'paying_workspaces', (select count(*) from public.org_subscriptions
                           where plan <> 'free' and status in ('active', 'trialing', 'past_due'))
  );
$$;

revoke all on function public.growth_overview() from public, anon, authenticated;
grant execute on function public.growth_overview() to service_role;

-- Signups on each of the last `days` UTC days (1 to 365), zero days included, and how many accounts there were by then.
create or replace function public.growth_signups_by_day(days int default 30)
returns table (day date, signups int, total int)
language sql
stable
security definer
set search_path = ''
as $$
  with span as (
    select greatest(1, least(coalesce(days, 30), 365)) as n, (now() at time zone 'UTC')::date as today
  ),
  series as (
    select generate_series(span.today - span.n + 1, span.today, interval '1 day')::date as d from span
  ),
  per_day as (
    select (u.created_at at time zone 'UTC')::date as d, count(*)::int as n from auth.users u group by 1
  )
  select s.d,
         coalesce(p.n, 0),
         (select count(*) from auth.users u where (u.created_at at time zone 'UTC')::date <= s.d)::int
    from series s
    left join per_day p on p.d = s.d
   order by s.d;
$$;

revoke all on function public.growth_signups_by_day(int) from public, anon, authenticated;
grant execute on function public.growth_signups_by_day(int) to service_role;

-- Active accounts on each of the last `days` UTC days, and the synced thread items under them (one Mac's busy day
-- looks the same as many quiet ones in `active`; `items` tells them apart).
create or replace function public.growth_active_by_day(days int default 30)
returns table (day date, active int, items int)
language sql
stable
security definer
set search_path = ''
as $$
  with span as (
    select greatest(1, least(coalesce(days, 30), 365)) as n, (now() at time zone 'UTC')::date as today
  ),
  since as (
    select ((span.today - span.n + 1)::timestamp at time zone 'UTC') as t from span
  ),
  series as (
    select generate_series(span.today - span.n + 1, span.today, interval '1 day')::date as d from span
  ),
  act as (
    select a.day as d, count(distinct a.user_id)::int as n
      from since, private.growth_activity(since.t) a
     group by 1
  ),
  items as (
    select (i.at at time zone 'UTC')::date as d, count(*)::int as n
      from since, public.cloud_thread_items i
     where i.at >= since.t
     group by 1
  )
  select s.d, coalesce(a.n, 0), coalesce(it.n, 0)
    from series s
    left join act a on a.d = s.d
    left join items it on it.d = s.d
   order by s.d;
$$;

revoke all on function public.growth_active_by_day(int) from public, anon, authenticated;
grant execute on function public.growth_active_by_day(int) to service_role;

-- Weekly cohorts by signup week (Monday, UTC). Week w of an account is days [7w, 7w + 7) after its own signup day;
-- `retained` counts the cohort's accounts active in their week w. A week appears once the cohort's first account has
-- reached it, up to `weeks` (1 to 52) weeks.
create or replace function public.growth_retention(weeks int default 8)
returns table (cohort date, size int, week int, retained int)
language sql
stable
security definer
set search_path = ''
as $$
  with span as (
    select greatest(1, least(coalesce(weeks, 8), 52)) as n, (now() at time zone 'UTC')::date as today
  ),
  members as (
    select u.id,
           (u.created_at at time zone 'UTC')::date as signup,
           date_trunc('week', u.created_at at time zone 'UTC')::date as cohort
      from auth.users u
  ),
  act as (
    select a.user_id, a.day from private.growth_activity((select min(u.created_at) from auth.users u)) a
  ),
  cohorts as (
    select m.cohort, count(*)::int as size, min(m.signup) as first_signup from members m group by 1
  ),
  cells as (
    select c.cohort, c.size, w.w
      from cohorts c
     cross join span
     cross join lateral generate_series(0, span.n - 1) as w(w)
     where c.first_signup + 7 * w.w <= span.today
  ),
  kept as (
    select m.cohort, c.w, count(distinct m.id)::int as n
      from members m
      join cells c on c.cohort = m.cohort
      join act a on a.user_id = m.id and a.day >= m.signup + 7 * c.w and a.day < m.signup + 7 * c.w + 7
     group by 1, 2
  )
  select c.cohort, c.size, c.w, coalesce(k.n, 0)
    from cells c
    left join kept k on k.cohort = c.cohort and k.w = c.w
   order by c.cohort, c.w;
$$;

revoke all on function public.growth_retention(int) from public, anon, authenticated;
grant execute on function public.growth_retention(int) to service_role;

-- Activation, in the order an account gets there. A workspace isn't a step: every account gets one when it's made.
create or replace function public.growth_funnel()
returns table (step text, "position" int, accounts int)
language sql
stable
security definer
set search_path = ''
as $$
  with accounts as (
    select u.id, greatest(u.last_sign_in_at, p.last_login_at) as last_in
      from auth.users u
      left join public.profiles p on p.id = u.id
  )
  select f.step, f.pos, f.n
    from (values
      ('Account created',     1, (select count(*)::int from accounts)),
      ('Signed in',           2, (select count(*)::int from accounts where last_in is not null)),
      ('Synced a folder',     3, (select count(distinct owner_user)::int from public.cloud_cards where not deleted)),
      ('Shared a card',       4, (select count(distinct created_by)::int from public.cloud_shares)),
      ('Used the Puku trial', 5, (select count(distinct user_id)::int from public.puku_trial_usage where requests > 0)),
      ('Invited a teammate',  6, (select count(distinct invited_by)::int from public.invitations))
    ) as f(step, pos, n)
   order by f.pos;
$$;

revoke all on function public.growth_funnel() from public, anon, authenticated;
grant execute on function public.growth_funnel() to service_role;
