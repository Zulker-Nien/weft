-- The public builder card on weft.zip/@username (docs/architecture/profiles.md): a snapshot of the Loom's
-- "You" tab that the signed-in Mac posts beside its league week (lib/profile-card-sync.ts). Level, class,
-- streak, attributes, skills, badges, the activity cloth, token usage and records; never prompts, code,
-- project names or folders. lib/public-profile.ts reads it through the service client and parses every field
-- again before the page draws it, so a hand-made post can't put anything else on the page.

create table public.profile_cards (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  card       jsonb not null check (jsonb_typeof(card) = 'object' and pg_column_size(card) <= 65536),
  updated_at timestamptz not null default now()
);

-- No policies: the Mac writes through profile_card_submit (as the caller only) and the page reads with the service role.
alter table public.profile_cards enable row level security;

create or replace function public.profile_card_submit(p_card jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Sign in to Weft to publish your profile.';
  end if;
  if jsonb_typeof(p_card) <> 'object' or pg_column_size(p_card) > 65536 then
    raise exception 'That profile card is not valid.';
  end if;
  insert into public.profile_cards (user_id, card, updated_at) values (me, p_card, now())
    on conflict (user_id) do update set card = excluded.card, updated_at = excluded.updated_at;
end;
$$;

revoke all on function public.profile_card_submit(jsonb) from public, anon;
grant execute on function public.profile_card_submit(jsonb) to authenticated;
