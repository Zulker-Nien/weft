-- Weekly leagues: builders ranked by the XP they earn Monday to Sunday, in leagues of up to 30 per tier (Cotton to
-- Gold Thread, lib/game.ts LEAGUES). Each signed-in Mac posts its week (lib/league-sync.ts): XP, cards shipped,
-- streak, level and the badges it earned that week. Never prompts, code or project names.
-- A week's tier is settled lazily: your first row of a week takes the tier your last week's rank earned (top 7 up,
-- bottom 5 down, scaled for small leagues), so no Monday job has to run. docs/architecture/gamification.md.

create table public.league_weeks (
  user_id    uuid not null references auth.users (id) on delete cascade,
  -- The Monday the week starts on, in the builder's own time zone.
  week       date not null check (extract(isodow from week) = 1),
  tier       smallint not null default 0 check (tier between 0 and 5),
  cohort     integer not null default 0 check (cohort >= 0),
  xp         integer not null default 0 check (xp between 0 and 200000),
  shipped    integer not null default 0 check (shipped between 0 and 10000),
  streak     integer not null default 0 check (streak between 0 and 10000),
  level      integer not null default 1 check (level between 1 and 1000),
  -- [{icon, name}] of the badges earned this week, at most 12.
  badges     jsonb not null default '[]'::jsonb check (jsonb_typeof(badges) = 'array' and jsonb_array_length(badges) <= 12),
  updated_at timestamptz not null default now(),
  primary key (user_id, week)
);

create index league_weeks_by_league on public.league_weeks (week, tier, cohort);

-- No policies: reads and writes go through the functions below, which only ever act as the caller.
alter table public.league_weeks enable row level security;

-- How many move up and down in a league of n: 7 and 5 in a full league of 30, scaled down for smaller ones,
-- so a league of 3 sends its winner up and nobody down.
create or replace function private.league_moves(n integer, out up integer, out down integer)
language sql
immutable
set search_path = ''
as $$
  select least(7, ceil(n * 7 / 30.0))::integer, least(5, floor(n * 5 / 30.0))::integer;
$$;

-- The tier a builder starts a week in: their last week's tier, moved by where they finished in it.
create or replace function private.league_tier_for(p_user uuid, p_week date)
returns smallint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  prev public.league_weeks;
  n integer;
  r integer;
  m record;
begin
  select * into prev from public.league_weeks where user_id = p_user and week < p_week order by week desc limit 1;
  if not found then
    return 0;
  end if;
  select count(*) into n from public.league_weeks where week = prev.week and tier = prev.tier and cohort = prev.cohort;
  select count(*) + 1 into r from public.league_weeks
    where week = prev.week and tier = prev.tier and cohort = prev.cohort and xp > prev.xp;
  select * into m from private.league_moves(n);
  if n > 1 and prev.xp > 0 and r <= m.up and prev.tier < 5 then
    return prev.tier + 1;
  end if;
  if r > n - m.down and prev.tier > 0 then
    return prev.tier - 1;
  end if;
  return prev.tier;
end;
$$;

-- Joins a builder to a week: their tier, and the first league of that tier with room (a new one when all are full).
create or replace function private.league_join(p_user uuid, p_week date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t smallint := private.league_tier_for(p_user, p_week);
  c integer;
begin
  if exists (select 1 from public.league_weeks where user_id = p_user and week = p_week) then
    return;
  end if;
  -- One join at a time per week and tier, so two builders can't both take a league's 30th seat.
  perform pg_advisory_xact_lock(hashtext('league:' || p_week::text || ':' || t::text));
  select cohort into c from public.league_weeks where week = p_week and tier = t
    group by cohort having count(*) < 30 order by cohort limit 1;
  if c is null then
    select coalesce(max(cohort) + 1, 0) into c from public.league_weeks where week = p_week and tier = t;
  end if;
  insert into public.league_weeks (user_id, week, tier, cohort) values (p_user, p_week, t, c)
    on conflict (user_id, week) do nothing;
end;
$$;

-- The Mac's weekly post (lib/league-sync.ts). The week is the Mac's own Monday, so it may sit a day off UTC's.
create or replace function public.league_submit(
  p_week date, p_xp integer, p_shipped integer, p_streak integer, p_level integer, p_badges jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  clean jsonb;
begin
  if me is null then
    raise exception 'Sign in to Weft to join a league.';
  end if;
  if extract(isodow from p_week) <> 1 or p_week < current_date - 8 or p_week > current_date + 1 then
    raise exception 'That is not this week.';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('icon', left(e->>'icon', 8), 'name', left(e->>'name', 40))), '[]'::jsonb)
    into clean
    from (select e from jsonb_array_elements(case when jsonb_typeof(p_badges) = 'array' then p_badges else '[]'::jsonb end) e limit 12) b;
  perform private.league_join(me, p_week);
  update public.league_weeks set
    xp = least(greatest(coalesce(p_xp, 0), 0), 200000),
    shipped = least(greatest(coalesce(p_shipped, 0), 0), 10000),
    streak = least(greatest(coalesce(p_streak, 0), 0), 10000),
    level = least(greatest(coalesce(p_level, 1), 1), 1000),
    badges = clean,
    updated_at = now()
  where user_id = me and week = p_week;
end;
$$;

-- The caller's league for a week, best first: each builder's display name, picture, username (profiles.username from
-- 20261017161000_profile_usernames.sql, read through to_jsonb so this doesn't depend on that migration; the GitHub login
-- before it's set) and their week. Empty until the caller has joined that week.
create or replace function public.league_standings(p_week date)
returns table (
  rank integer, user_id uuid, name text, avatar_url text, username text, xp integer, shipped integer,
  streak integer, level integer, badges jsonb, is_me boolean, tier smallint, size integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with mine as (
    select tier, cohort from public.league_weeks where user_id = auth.uid() and week = p_week
  ), league as (
    select w.* from public.league_weeks w, mine where w.week = p_week and w.tier = mine.tier and w.cohort = mine.cohort
  )
  select
    (rank() over (order by l.xp desc))::integer,
    l.user_id,
    coalesce(nullif(p.display_name, ''), nullif(p.name, ''), 'Builder'),
    p.avatar_url,
    coalesce(to_jsonb(p)->>'username', u.raw_user_meta_data->>'user_name'),
    l.xp, l.shipped, l.streak, l.level, l.badges,
    l.user_id = auth.uid(),
    l.tier,
    (count(*) over ())::integer
  from league l
  left join public.profiles p on p.id = l.user_id
  left join auth.users u on u.id = l.user_id
  order by l.xp desc, 3;
$$;

revoke all on function public.league_submit(date, integer, integer, integer, integer, jsonb) from public, anon;
revoke all on function public.league_standings(date) from public, anon;
grant execute on function public.league_submit(date, integer, integer, integer, integer, jsonb) to authenticated;
grant execute on function public.league_standings(date) to authenticated;
revoke all on function private.league_tier_for(uuid, date) from public, anon, authenticated;
revoke all on function private.league_join(uuid, date) from public, anon, authenticated;

-- A new account joins this week's Cotton league right away, so friends see you the day you sign up.
create or replace function private.league_enroll()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.league_join(new.id, date_trunc('week', now() at time zone 'utc')::date);
  return new;
exception when others then
  -- A league is never worth a failed sign-up: the Mac's first post joins them instead.
  raise warning 'league enroll failed for %: %', new.id, sqlerrm;
  return new;
end;
$$;

create trigger profiles_league_enroll
  after insert on public.profiles
  for each row execute function private.league_enroll();

-- Everyone who signed up before leagues: into this week's league.
select private.league_join(id, date_trunc('week', now() at time zone 'utc')::date) from public.profiles;
