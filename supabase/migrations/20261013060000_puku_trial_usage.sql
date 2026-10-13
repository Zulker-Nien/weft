-- The Puku trial's daily meter (docs/architecture/puku-trial.md). Puku threads without a Puku login of their own
-- go through the proxy on the deployed Weft (Vercel, lib/puku-proxy.ts), which uses Weft's own Puku key and counts
-- each Weft account's requests and tokens per UTC day here, to hold everyone to a daily cap.

create table public.puku_trial_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  requests integer not null default 0,
  input_tokens bigint not null default 0,
  cache_read_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

alter table public.puku_trial_usage enable row level security;

-- You can see your own usage; only the proxy (with a secret key, which skips row-level security) writes it.
create policy "puku_trial_usage: read own" on public.puku_trial_usage
  for select to authenticated using ((select auth.uid()) = user_id);

revoke all on public.puku_trial_usage from anon, authenticated;
grant select on public.puku_trial_usage to authenticated;

-- Adds to a user's row for the day and returns the totals after it, in one statement, so two requests at once
-- can't both read a total under the cap.
create function public.puku_trial_add(
  p_user uuid,
  p_day date,
  p_requests integer,
  p_input bigint,
  p_cache_read bigint,
  p_output bigint
) returns public.puku_trial_usage
language sql
security invoker
set search_path = ''
as $$
  insert into public.puku_trial_usage as u (user_id, day, requests, input_tokens, cache_read_tokens, output_tokens)
  values (p_user, p_day, p_requests, p_input, p_cache_read, p_output)
  on conflict (user_id, day) do update set
    requests = u.requests + excluded.requests,
    input_tokens = u.input_tokens + excluded.input_tokens,
    cache_read_tokens = u.cache_read_tokens + excluded.cache_read_tokens,
    output_tokens = u.output_tokens + excluded.output_tokens,
    updated_at = now()
  returning u.*;
$$;

revoke execute on function public.puku_trial_add(uuid, date, integer, bigint, bigint, bigint) from public, anon, authenticated;
grant execute on function public.puku_trial_add(uuid, date, integer, bigint, bigint, bigint) to service_role;
