# Cloud sync

Status: first shot, 2026-10-15. The outbox runs from `prewarm()` but does nothing until a folder is in settings
`syncFolders` (no switch for it yet), and `supabase/migrations/20261015140000_card_sync.sql` isn't applied. Item
bodies go up as plain JSON, so this isn't offered to anyone until they're sealed (see Gaps).

The goal: a card's thread reads the same on another device as on the Mac that runs it. `lib/cloud-sync-types.ts`
is the contract between the parts:

- `lib/cloud-sync.ts`: the outbox. A bus listener (no network, no awaits) turns `card`, `card_deleted` and `thread`
  events for opted-in folders into lines in `~/.weft/sync-outbox.jsonl` (`lib/cloud-outbox.ts`). A turn's `result`
  item flushes at once; everything else waits for a 10 s tick, so a streaming turn is one batch. A flush compacts the
  file, then uploads from the store's current state (not the event), one upsert per table, and drops the lines it
  read by position, so an update that lands mid-upload stays queued. Signed out or no workspace: entries wait. An
  error: backoff from 1 s doubling to 5 min, one warning per streak. Cards go to the user's personal workspace (the
  first org they own).
- `lib/blob-store.ts`: images, attachments and `~/.weft/show` pages referenced by an item are hashed (sha256),
  uploaded once to `weft-blobs/<org>/<sha>` and swapped for `blob:sha256:…` in the uploaded copy. Never anything
  outside home, in the vault, a token file or a `.env*`.
- `lib/thread-page.ts` + `app/api/cards/[id]/thread`: the reader side's shape, already used locally. `?before=&limit=`
  pages from the newest item back; a tool result over 2 KB (`TOOL_RESULT_INLINE_MAX`) is left out with
  `resultBytes`, and `/thread/tool/[toolId]` (or `cloud_tool_outputs` remotely) serves it when the row opens
  (`lib/use-tool-result.ts`). Tool output is ~70% of a thread's bytes.
- `lib/device-id.ts`: a random id for this Mac in `~/.weft/device-id`.

## Ownership

The Mac running a card owns it: `owner_user` is the account that runs it and the only one that may write its rows,
`owner_device` is which of that account's Macs. Everyone else in the workspace can read. A deleted card keeps its row
with `deleted` set.

## Schema

Three tables, all keyed on `(org_id, card_id)` so a workspace's cards sit side by side and a single
policy covers them.

### `cloud_cards`

One row per synced card, upserted on every change. The jsonb body is the card's metadata
(`lib/types.ts`'s `Card`): column, title, tags, assignee, the latest cli/model, the unread count. Not
the thread — that's `cloud_thread_items`. `updated_at` is touched by `private.touch_updated_at`, the same
trigger the teams and profiles tables use, so Realtime subscribers know the card moved.

### `cloud_thread_items`

One row per thread item, paged newest first by the thread route. `item` is the `ThreadItem` jsonb with
two transformations already applied: a tool result longer than `TOOL_RESULT_INLINE_MAX` (2 KB) is
replaced with a `resultBytes` reference, and any local path (an attachment, an image, a `~/.weft/show`
page) is swapped for a `blob:sha256:…` ref that points at `weft-blobs`. The full tool result is in
`cloud_tool_outputs`; the blob itself is in the storage bucket. The index on `(org_id, card_id, seq
desc)` is the paging query, verbatim.

### `cloud_tool_outputs`

One row per cut tool result, keyed by the same `(org_id, card_id)` plus the tool id. The thread page
fetches this when it opens an item that names a cut tool — locally from
`/api/cards/[id]/thread/tool/[toolId]`, remotely from the cloud table. `bytes` is the result's length so
a reader can show "12 KB" without downloading.

### The `weft-blobs` storage bucket

A private bucket. Each object is a file at path `<org_id>/<sha256>`: the org prefix is the access
boundary, the sha256 is the file's identity (a 16 KB image uploaded from two Macs lands at the same key,
so the second upload is a no-op). Members of the org may read and insert; there are no update or delete
policies for clients. A blob is alive for as long as anything still references it — a `cloud_thread_items`
item, a pane image, a `~/.weft/show` page — and a sync sweep on the owner Mac prunes the unreferenced
ones.

## Policies

Three rules, written in the migration's comments:

- **Members of the org may read all three tables and the bucket.** A card that was opened on one Mac is
  visible to the rest of the workspace; the `is_org_member(uuid)` helper from
  `20261013171000_teams_rls.sql` is the only check.
- **Only the owner may write a card's row.** `owner_user = auth.uid()` on `cloud_cards` directly, and on
  `cloud_thread_items` and `cloud_tool_outputs` through the new `private.is_card_owner(org, card)`
  helper, which reads `cloud_cards` as its owner (`security definer`) so an item's policy doesn't
  recurse into the items table's own policy or hit `cloud_cards`'s policy at row-read time.
- **No client updates or deletes to the bucket.** Blobs are content-addressed; there is nothing for a
  client to "edit".

`auth.uid()` is wrapped in `(select auth.uid())` everywhere a policy references it, the way the other
migrations do, so the result caches for the row.

## Realtime

`cloud_cards` and `cloud_thread_items` are in the `supabase_realtime` publication, the same way
`github_events`, `webhook_deliveries` and `vercel_events` are, so another device hears a new item the moment
the owner's outbox posts it. `cloud_tool_outputs` is left out: outputs are big and fetched only when a row is
opened.

## Gaps

- Item bodies go up as plain JSON. Sealing them with the workspace key (teams-vault.md) has to land before
  sync is offered to anyone else.
- Nothing reads the rows back yet: the remote reader (another device's board, live over Realtime, replies
  queued to the owner) is the next sprint.
- Two Macs on one account can both write the same card: the policies check the account, not `owner_device`.
- Blobs are never pruned.
- No switch for `syncFolders` in the UI yet; it's only in `~/.weft/settings.json`.
- `Board.tsx` still fetches a card's whole thread and hands it to ThreadView as a seed, so paging doesn't yet save the
  first load; ThreadView then opens its own event stream (`useBoardEvents`) to keep its window live.
- An HTML page uploaded as a blob still points at its images by their local relative paths.
