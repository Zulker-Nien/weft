# Cloud sync

Status: schema-only, 2026-10-15. The tables, the storage bucket and the policies in
`supabase/migrations/20261015140000_card_sync.sql` go live with the next migration push; the outbox in
`lib/cloud-sync.ts` and the blob store in `lib/blob-store.ts` are not yet wired up.

A Weft card is a thread, and a thread is a long file. Most of the time that file is enough — the Mac the
card is open on has it. But a teammate in the same workspace, on another Mac, can also open that card,
see the thread as it stood when the last sync happened, and queue replies the owner will see. Sync is
opt-in per folder (Settings → Threads → **Sync folders**, off by default) and lives in the org the card's
folder belongs to. `lib/cloud-sync-types.ts` is the type contract; this document is the rest.

## Ownership

The Mac running a card **owns** it. owner_user on the card row is the account that has it open;
owner_device is the Mac itself (`lib/device-id.ts`). Every other Mac in the org can read that card; only
the owner's Mac can write to it. A teammate queueing a reply does it on their own card (the reply is
uploaded to the owner's `cloud_thread_items` as the owner, because the outbox on the owner's Mac writes
it; a Mac that hasn't opened the card yet has no row to write into). When the owner closes the card the
row stays — `deleted` flips, the items stay readable until the next sync sweep, and the row is what
someone opening the card again would land on.

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
