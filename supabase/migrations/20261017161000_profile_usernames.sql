-- Public profiles at weft.zip/@username (lib/public-profile.ts, docs/architecture/profiles.md). Every account gets a
-- username from its GitHub login (or the email's local part), lowercased like GitHub treats logins, -2, -3… on a
-- clash. The page reads it with the service role and shows only public columns (never email), so no anon policy
-- is added here: profiles stay readable to their owner and teammates only, as before.

alter table public.profiles
  add column username text check (username ~ '^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$');

create unique index profiles_username_key on public.profiles (username);

-- Shaped like a GitHub login: letters, digits and single hyphens, at most 39 characters.
create or replace function private.username_for(seed text)
returns text
language plpgsql
set search_path = ''
as $$
declare
  base text := left(trim(both '-' from regexp_replace(lower(coalesce(seed, '')), '[^a-z0-9]+', '-', 'g')), 36);
  candidate text;
  n int := 1;
  reserved text[] := array['admin', 'api', 'help', 'official', 'root', 'staff', 'support', 'system', 'weft'];
begin
  base := trim(both '-' from base);
  if base = '' then base := 'wefter'; end if;
  candidate := base;
  while candidate = any(reserved) or exists (select 1 from public.profiles p where p.username = candidate) loop
    n := n + 1;
    candidate := base || '-' || n;
  end loop;
  return candidate;
end;
$$;

create or replace function private.handle_new_user_username()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
    set username = private.username_for(coalesce(new.raw_user_meta_data ->> 'user_name', split_part(new.email, '@', 1)))
    where id = new.id and username is null;
  return new;
-- A username that can't be set (a race on the unique index, say) must never block the sign-up itself.
exception when others then
  raise warning 'username for % not set: %', new.id, sqlerrm;
  return new;
end;
$$;

revoke all on function private.username_for(text) from public, anon, authenticated;
revoke all on function private.handle_new_user_username() from public, anon, authenticated;

-- Named so it sorts after on_auth_user_created: triggers fire in name order, and the profile row must exist first.
create trigger on_auth_user_created_username
  after insert on auth.users
  for each row execute function private.handle_new_user_username();

-- Backfill, oldest account first so the earliest sign-up keeps the bare login on a clash. One row at a time:
-- username_for looks at the rows already given a name.
do $$
declare
  u record;
begin
  for u in select a.id, a.email, a.raw_user_meta_data from auth.users a join public.profiles p on p.id = a.id
           where p.username is null order by a.created_at loop
    update public.profiles
      set username = private.username_for(coalesce(u.raw_user_meta_data ->> 'user_name', split_part(u.email, '@', 1)))
      where id = u.id;
  end loop;
end;
$$;
