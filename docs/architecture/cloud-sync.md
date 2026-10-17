# Cloud sync

Status: usable, off by default, 2026-10-16. A card can be started from the web board (see Commands); the `cloud_commands` migration is applied. Settings → Sync turns a project on, and the web board at
`weft.zip/<workspace>/board` reads its cards back live. The migration is applied. Item bodies go up as plain JSON, so
this isn't offered to anyone else until they're sealed (see Gaps).

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
  That includes the page each `mcp__browser__open_url` call opened (its `summary` becomes `blob:sha256:<hex>#anchor`, the
  anchor kept verbatim) and a message's `page` with its anchor, so a card's pane history reads remotely (sharing.md). The path
  rules live in `lib/blob-paths.ts`.
- `lib/cloud-sync-cards.ts`: builds the `cloud_cards` rows, uploading each card's pane capture (`thumb`, an
  `/api/attachments/…` file) as a blob and putting the ref in the uploaded copy only; the web board resolves it with
  the thread's refs (`lib/web-board-thumbs.ts`).
- `lib/thread-page.ts` + `app/api/cards/[id]/thread`: the reader side's shape, already used locally. `?before=&limit=`
  pages from the newest item back; a tool result over 2 KB (`TOOL_RESULT_INLINE_MAX`) is left out with
  `resultBytes`, and `/thread/tool/[toolId]` (or `cloud_tool_outputs` remotely) serves it when the row opens
  (`lib/use-tool-result.ts`). Tool output is ~70% of a thread's bytes.
- `lib/device-id.ts`: a random id for this Mac in `~/.weft/device-id`.
- Settings → Sync (`components/SyncSettings.tsx`, a page after Team in `lib/settings-nav.ts`): a status card ("Last sync 2m ago ·
  341 items uploaded · 0 waiting", "Sign in to Weft to sync", "Open the web board to claim your workspace", or the last error)
  with **Sync now**, then one switch per recent project, with a caution that thread text is uploaded unencrypted. It polls
  `/api/cloud-sync` every 5 s through `lib/use-cloud-sync.ts` (`GET` → `{ folders, status }`; `POST { folder, on }` switches a folder
  and, when on, `queueFolder()` queues its existing cards and items; `POST { sync: true }` flushes now). The status
  (`cloudSyncStatus()`, type in `lib/cloud-sync-view.ts`) is `waiting` (outbox lines), `lastSyncAt`, `uploaded` since start,
  `lastError`, `signedOut`, `noWorkspace`. Folders live in settings `syncFolders` (`setSyncFolder`).
- The web board (`app/[orgSlug]/board/page.tsx`, `components/web-board/*`, pure logic in `lib/web-board.ts`): behind the same
  `requireTeam` gate as Team and Billing, read as the visitor through their cookie session, so RLS decides what they see.
  It is the desktop board drawn read-only, not a lookalike: the cards are `components/CardView.tsx` with `readOnly` (no drag,
  stop, answer, resume, star or archive), the columns and their counts are `ColumnHeader` and `ColumnPlaceholder`, and what a
  column holds comes from the desktop's own `lib/board-view.ts` (`groupByColumn`, `summarizeProjects`, `SORTERS`), so a change
  to the board reaches both. `WebProjectBar` is its project chips, filter box and sort; `.wz-desk` (`web-board.css`) gives the
  subtree the dark desktop tokens and the full window instead of the workspace shell's 880px column. The server renders the
  workspace's non-deleted cards (the copilot is left out); `useWebBoard` subscribes to Realtime `postgres_changes` on
  `cloud_cards` and `cloud_thread_items` (filter `org_id=eq.<id>`) and moves, adds and removes cards in place, with a Live dot
  that goes grey when the channel drops. `?card=<id>` opens a card's thread in `WebThreadPanel`: `groupThread` and
  `ThreadEntries` from the desktop (oldest first, tool runs folded, `Markdown`), newest 50 first with "Load earlier messages",
  blob refs resolved to hour-long signed URLs from `weft-blobs` as items arrive (live ones too), and a tool output over 2 KB
  read from `cloud_tool_outputs` when its row opens, through `ToolResultSourceContext` in `lib/use-tool-result.ts` (the desktop
  fetches the same row from its own server). A signed blob link has no file extension, so `mediaKind` takes it for an image.
  The cards' own controls (drag, stop, answer, star, archive) are absent; the board's one write is **New thread** (see Commands).

## Commands: starting a card from the web

The web can't run a thread, so a card made there is a request to a Mac. `public.cloud_commands`
(`supabase/migrations/20261016130000_card_commands.sql`, contract in `lib/cloud-commands.ts`) holds one row per request:
`kind` (`new_card`), `target_device` and `folder` (a `cloud_cards.owner_device`/`folder` pair of the author's own cards), a `payload`
(`prompt`, `backend`, `model`, `effort`; never the permission mode) and a `status` (`pending` → `claimed` → `done`, or `failed` with an
`error`, plus the `card_id` made).

- **Web** (`components/web-board/WebNewCardDialog.tsx`, `useWebBoard.startCard`, `lib/web-commands.ts`): the header's New thread offers
  `webTargets` (folders of cards whose `owner_user` is you), inserts the row as you, and `WebCommandStrip` follows it ("Waiting for your Mac",
  "Starting…", the failure, Cancel/Dismiss) over Realtime. When the command is done and the card's row has synced back, the board opens the card.
- **Mac** (`lib/cloud-inbox.ts`, started with the outbox from `cloud-sync-start.ts`): while you're signed in and a folder syncs it listens on
  `cloud_commands` filtered to this device, and checks every 30 s as well (a socket can drop while the Mac sleeps). A Realtime event is only a
  nudge: it reads this device's pending commands made by the signed-in account, claims each with an update that only matches `pending`
  (so one runs once), refuses it unless the folder is in `syncFolders` and `org_id` is the workspace this Mac syncs to, then
  `createCardFromBody` (shared with `POST /api/cards`, `lib/new-card.ts`) and `startCard` run it with the Mac's own default permission mode.
  It reports `done` + `card_id` or `failed` + a short reason; a claimed command is never retried, so a card can't be made twice.
- **Policies**: members read; a member inserts as themselves (only `org_id, kind, target_device, folder, payload` are grantable, so a client can't
  write its own status); only the author updates `status, card_id, error` or deletes (cancel before it runs, clear after).

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
- A reply typed on the web can't reach a running thread yet (the commands table has room for a `reply` kind). A thread the Mac starts for the web that needs a yes waits in Needs you; there is no answering it from the web.
- A teammate's Mac never acts on your requests and yours never acts on theirs: the Mac only runs commands its own account made. Sending work to a teammate would need an explicit opt-in.
- Finished commands stay in `cloud_commands`; nothing prunes them yet. A command whose Mac crashed between claiming and reporting stays `claimed` until it's cancelled.
- The Mac must be on and running Weft for a command to run; the web says "Waiting for your Mac" until it is.
- Settings → Sync's "Open the web board" opens `weft.zip/team`, because the app doesn't know the workspace slug; the
  workspace header there has the Board link.
- Two Macs on one account can both write the same card: the policies check the account, not `owner_device`.
- Blobs are never pruned.
- `Board.tsx` still fetches a card's whole thread and hands it to ThreadView as a seed, so paging doesn't yet save the
  first load; ThreadView then opens its own event stream (`useBoardEvents`) to keep its window live.
- An HTML page uploaded as a blob still points at its images by their local relative paths.
