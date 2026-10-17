-- A second kind of web → Mac command: a reply typed into a card's thread on weft.zip, for the Mac that runs the card
-- to send as if typed there (lib/cloud-commands.ts replyCommand, lib/cloud-inbox.ts replyFromCommand). The payload is
-- { cardId, text }; target_device and folder are the card's own, so the Mac's checks (its device, its account, a
-- synced folder, its workspace) are the same as for a new card, plus the card being in that folder.
alter table public.cloud_commands drop constraint cloud_commands_kind_check;
alter table public.cloud_commands add constraint cloud_commands_kind_check check (kind in ('new_card', 'reply'));
