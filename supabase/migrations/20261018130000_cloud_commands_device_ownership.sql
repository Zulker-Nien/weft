-- Tightens public.cloud_commands so a workspace member can't poke noise into another device's
-- inbox, and so a finished command can't claim a card_id pointing at someone else's card. L-1
-- narrows the insert policy to a device the caller owns; L-2 narrows the card_id write so it only
-- lands on a row the caller's own Mac actually claimed and produced. The card_id column stays
-- writeable by the authenticated author, but a trigger refuses the write if either the prior
-- status wasn't 'claimed' or the new card_id doesn't point at a card the caller owns. Without
-- the trigger, an author could patch their own 'pending' or 'done' row to claim they made
-- someone else's card; with it, the only path to setting card_id is "I'm the device, I just made
-- the card, this is the one I made".
--
-- "Owns the device" is defined as "has at least one cloud_cards row for this device" — cloud_cards
-- row ownership already uses auth.uid() as its owner_user, and the outbox uploads those rows
-- when sync is on. A device the user has never run a card on has no rows, so the helper
-- correctly denies that case.

-- A "device" is a row of cloud_cards the caller has uploaded (lib/cloud-sync-upload.ts). Looking
-- it up through cloud_cards means the answer lines up with the same auth.uid() + ownership
-- semantics the writes already use.
create or replace function private.owns_device(device text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.cloud_cards c
    where c.owner_device = device and c.owner_user = (select auth.uid())
  );
$$;

grant execute on function private.owns_device(text) to authenticated;
revoke all on function private.owns_device(text) from public, anon;

-- L-1: drop and re-create the insert policy with the device check. Without the check, a teammate
-- can spam any device's inbox; the Mac filters at drain time (lib/cloud-inbox.ts) but the noise
-- still pins against the device's daily quota. With it, the policy refuses at write.
drop policy if exists "cloud_commands: insert as member" on public.cloud_commands;
revoke insert on public.cloud_commands from authenticated;

create policy "cloud_commands: insert as member" on public.cloud_commands
  for insert to authenticated
  with check (private.is_org_member(org_id) and (select auth.uid()) = created_by and private.owns_device(target_device));

grant insert (org_id, kind, target_device, folder, payload) on public.cloud_commands to authenticated;

-- L-2: the update policy already restricts the writer to the author; card_id stays in the grant
-- so the Mac can still report the card it just made, but a trigger blocks writes that aren't
-- the legitimate "claimed → done with my own card" transition. The trigger is the policy that
-- a row-level check can't express cleanly: it needs both the prior status and the new card_id
-- pointing at a card the caller owns. The card-ownership check goes through a security-definer
-- helper so RLS on cloud_cards doesn't apply (the trigger function is the owner of the check,
-- not the caller), and the caller's auth.uid() is what the helper filters on.
create or replace function private.card_owned_by_caller(org uuid, card text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.cloud_cards c
    where c.org_id = org and c.card_id = card and c.owner_user = (select auth.uid())
  );
$$;

grant execute on function private.card_owned_by_caller(uuid, text) to authenticated;
revoke all on function private.card_owned_by_caller(uuid, text) from public, anon;

-- Trigger function runs as the caller (no security clause) so auth.uid() reflects the writer
-- and any helper it calls runs with that uid.
create or replace function private.cloud_commands_card_id_check()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Only constrain writes that set card_id; status-only and error-only transitions are still
  -- free. NEW.card_id is distinct from OLD.card_id.
  if NEW.card_id is not null and (OLD.card_id is null or NEW.card_id <> OLD.card_id) then
    if OLD.status <> 'claimed' then
      raise exception 'card_id may only be set on a claimed command';
    end if;
    if not private.card_owned_by_caller(NEW.org_id, NEW.card_id) then
      raise exception 'card_id must point at a card the caller owns';
    end if;
  end if;
  return NEW;
end;
$$;

-- Trigger functions don't need EXECUTE grants; the trigger itself is what grants access.
drop trigger if exists cloud_commands_card_id_guard on public.cloud_commands;
create trigger cloud_commands_card_id_guard
  before update on public.cloud_commands
  for each row execute function private.cloud_commands_card_id_check();
