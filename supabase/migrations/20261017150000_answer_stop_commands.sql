-- Two more kinds of web → Mac command: an answer to a card's pending permission request or question
-- (lib/cloud-commands.ts answerCommand → answerBody, lib/cloud-inbox.ts answerFromCommand), and a stop
-- for a card's running turn (lib/cloud-commands.ts stopCommand → stopBody, lib/cloud-inbox.ts stopFromCommand).
-- Both target the card's own device and folder, so the Mac's checks (its device, its account, a synced folder,
-- its workspace) are the same as for a new card or a reply, plus the card being in that folder.
alter table public.cloud_commands drop constraint cloud_commands_kind_check;
alter table public.cloud_commands add constraint cloud_commands_kind_check check (kind in ('new_card', 'reply', 'answer', 'stop'));
