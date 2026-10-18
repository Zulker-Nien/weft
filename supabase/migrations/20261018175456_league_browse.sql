-- Browse any tier's leagues, not just your own (the board's Leagues dialog, components/LeaguesDialog.tsx): every
-- league of a tier for a week, each ranked within itself, with the same columns league_standings shows your own
-- league's builders. Read-only and for signed-in builders only; the first 10 leagues of a tier (300 builders) at most.

create or replace function public.league_browse(p_week date, p_tier smallint)
returns table (
  cohort integer, rank integer, user_id uuid, name text, avatar_url text, username text, xp integer, shipped integer,
  streak integer, level integer, badges jsonb, is_me boolean, size integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with cohorts as (
    select distinct w.cohort from public.league_weeks w where w.week = p_week and w.tier = p_tier order by w.cohort limit 10
  ), tier as (
    select w.* from public.league_weeks w join cohorts c on c.cohort = w.cohort where w.week = p_week and w.tier = p_tier
  )
  select
    l.cohort,
    (rank() over (partition by l.cohort order by l.xp desc))::integer,
    l.user_id,
    coalesce(nullif(p.display_name, ''), nullif(p.name, ''), 'Builder'),
    p.avatar_url,
    coalesce(to_jsonb(p)->>'username', u.raw_user_meta_data->>'user_name'),
    l.xp, l.shipped, l.streak, l.level, l.badges,
    l.user_id = auth.uid(),
    (count(*) over (partition by l.cohort))::integer
  from tier l
  left join public.profiles p on p.id = l.user_id
  left join auth.users u on u.id = l.user_id
  where auth.uid() is not null
  order by l.cohort, l.xp desc, 4;
$$;

revoke all on function public.league_browse(date, smallint) from public, anon;
grant execute on function public.league_browse(date, smallint) to authenticated;
