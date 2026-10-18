-- One atomic step for the unlock rate limit (lib/share-unlock-rate.ts). The first version read the row
-- and then updated it in two round trips, so two POSTs racing on the same (ip_hash, share_id) could
-- both read count < max and both pass (pentest 2026-10-18, F-2). This function does the window roll and
-- the bump in a single INSERT … ON CONFLICT DO UPDATE, which takes the row lock: racing callers queue
-- on the row and each sees the one before it.
--
-- The count is capped at max + 1, so a denied attempt doesn't keep growing it; an attempt is allowed
-- when the row's count after the step is <= max. `p_now` comes from the caller so the window matches
-- the Retry-After the route computes.

create or replace function public.share_unlock_bump(
  p_ip_hash text,
  p_share_id text,
  p_now timestamptz,
  p_window_ms bigint,
  p_max integer
) returns table (allowed boolean, first_at timestamptz)
language plpgsql
security invoker
set search_path = public
as $$
declare
  window_start timestamptz := p_now - make_interval(secs => p_window_ms / 1000.0);
  row_count integer;
  row_first timestamptz;
begin
  insert into public.share_unlock_attempts as a (ip_hash, share_id, count, first_at)
  values (p_ip_hash, p_share_id, 1, p_now)
  on conflict (ip_hash, share_id) do update set
    count = case when a.first_at <= window_start then 1 else least(a.count + 1, p_max + 1) end,
    first_at = case when a.first_at <= window_start then p_now else a.first_at end
  returning a.count, a.first_at into row_count, row_first;
  return query select row_count <= p_max, row_first;
end;
$$;

-- Only the deployed Weft's service role calls it, like the table itself.
revoke all on function public.share_unlock_bump(text, text, timestamptz, bigint, integer) from public, anon, authenticated;
grant execute on function public.share_unlock_bump(text, text, timestamptz, bigint, integer) to service_role;
