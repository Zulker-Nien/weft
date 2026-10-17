# Sharing a card

Status: built 2026-10-17; needs the `cloud_shares` migration applied and `SHARE_GATE_SECRET` on Vercel.

**Share…** on a card's right-click menu (⇧S), or the share icon in the browser pane's toolbar beside ☆ and Archive (`components/PaneCardMarks.tsx`; in the thread header when the pane is closed), gives one link, `weft.zip/s/<id>`, that shows the card's thread on the left and
the page its browser pane shows on the right, live, to whoever the link is for. Its access modes, dialog, unlock form,
pass cookie and password hashing come from `@aimhuge/share` (aimhuge/components, the same package DeckCP's deck sharing
was extracted into). Weft brings the resource (a card), its storage and its routes.

Sharing reads what cloud sync (cloud-sync.md) already uploads, so a card is shared only from a synced folder; the dialog
offers to turn sync on for it.

## Modes

The package's modes, minus one: a card never takes `public_edit`, because editing a thread would mean sending a turn
that runs on the owner's Mac (`CardShareMode`, `isCardShareMode` in `lib/share-types.ts`; the dialog passes
`allowEdit={false}`).

| Mode | Who gets in |
|---|---|
| `private` | Signed-in members of the card's workspace (the same people the web board shows it to). The row and its id stay, so opening it up again reuses the link. |
| `public` | Anyone with the link. |
| `email` | Anyone with the link who gives an email; each one lands in `cloud_share_visits`. |
| `password` | Anyone with the link and the password. Only its scrypt hash leaves the Mac. |

Passing a gate sets a signed, httpOnly pass cookie for that share (`lib/share-gate.ts`, `createShareGate` with the
`weft_share_` prefix), good for 30 days. With no `SHARE_GATE_SECRET` in production the gate mints and accepts nothing:
gated links answer "Sharing isn't set up on this server" rather than trusting a published constant.

## The parts

- `lib/share-types.ts`: the contract. Row shapes, `newShareId` (16 random bytes, base64url), `shareUrl`, the desktop's
  `CardShareState`, the viewer's `ShareLive`, and `paneFor` / `paneFromUrl`, which pick the pane from the thread.
- Desktop: `lib/card-share.ts` + `app/api/cards/[id]/share` (GET/PUT) read and write the card's `cloud_shares` row through
  the signed-in account, in the workspace cloud sync uploads to. The states: `signed-out`, `no-workspace`, `not-synced`
  (with the folder), `pending` (the card's `cloud_cards` row isn't up yet, so a flush is asked for), `ok`.
  `components/ShareCardDialog.tsx` is the package's `ShareDialog` + `ShareAccessFields` + `CopyLinkButton` over
  `useShareAccess`, opened from **Share…** in `lib/card-menu.ts`.
- Deployed: `app/s/[id]/page.tsx` loads the share with the service client (`lib/share-access.ts`), decides
  ok / gate / login / denied / missing, and renders `ShareGateForm` or `components/share-view/SharedCard.tsx`.
  `app/api/s/[id]/unlock` checks a password or records an email, then grants the pass. `app/api/s/[id]/live` is the
  viewer's poll (`lib/share-live.ts`); `app/api/s/[id]/page/[sha]` serves an uploaded page.

## The pane

The thread already records what the pane showed: each `mcp__browser__open_url` call's `summary` is the URL, and each
message you send carries the page on screen (`page`, `lib/pane-page.ts`). `paneFor` takes the newest of those, across
the whole thread, as one of three kinds:

- `blob`: a local file, usually a `~/.weft/show` page. The outbox uploads it like any other blob and writes
  `blob:sha256:<hex>#anchor` into the uploaded copy (`lib/blob-store.ts`). The viewer frames
  `/api/s/<id>/page/<sha>#anchor`, which serves it with `Content-Security-Policy: sandbox allow-scripts allow-popups allow-forms`:
  the page runs, but in an opaque origin, so its scripts can never read weft.zip's cookies.
  The route serves only the blob of this card's own current pane (`loadPaneAcrossThread`), never another upload in the
  workspace, and masks key-shaped text in what it serves, the way the thread is.
- `site`: a public URL, framed directly, with an Open link for the sites that refuse to be framed.
- `local`: only reachable on the owner's Mac (localhost, a file that didn't upload). The viewer shows the card's pane
  capture instead: the thumbnail `lib/glance.ts` takes after each turn, which the outbox now uploads as a blob too.

## Live

Visitors aren't workspace members, so they can't use Realtime under RLS. The viewer polls `/api/s/<id>/live?after=<seq>`
every 4 s (`SHARE_POLL_MS`) while its tab is visible. Every poll re-checks access (the pass cookie, the mode, a deleted
card) and returns new items newest first, the card, the pane and hour-long signed URLs for every blob they use. Items
merge by seq, so one that changed in place is replaced. `?before=<seq>` pages back for "Load earlier messages".

## What a viewer never gets

- The rest of the card: the viewer gets `id`, `title`, `emoji`, `column`, `tags` and an uploaded `thumb` (`toShareCard`, `ShareCard`),
  never its folder, session id, pending question or task command lines; a `local` pane keeps its label but not its address
  (`publicPane`).
- Key-shaped text: every string in every item goes through `lib/share-redact.ts`, which replaces what
  `lib/secret-detect.ts` finds with `‹hidden: <kind>›`.
- Long tool outputs: an output over 2 KB is cut from the item by cloud sync anyway, and the viewer's tool-result
  source answers "Long output isn't shared." instead of fetching it from `cloud_tool_outputs`.
- The password hash: `authenticated` can't select `cloud_shares.password_hash` (column grants); clients read
  `has_password`.

## Schema

`supabase/migrations/20261017130000_card_shares.sql`:

- `cloud_shares`: one row per shared card (`unique (org_id, card_id)`, a foreign key to `cloud_cards` that cascades),
  `id`, `mode`, `password_hash`, generated `has_password`, `created_by`. Members read; only the card's owner
  (`private.is_card_owner`) writes.
- `cloud_share_visits`: `share_id`, `email`, `at`. Written by the deployed Weft with the service role; the card's owner reads.

## Gaps

- Item bodies are plain JSON on Supabase (cloud-sync.md's gap), and a public link puts them in front of anyone with it.
  Redaction catches known key shapes, not everything a tool printed.
- An uploaded page still points at its images by local relative paths, so a show page's own pictures don't load remotely.
- The unlock route's rate limit (10 tries per 10 minutes per IP and share) lives in one server instance's memory, so each Vercel instance counts on its own; a password is brute-forceable only as fast as new instances spin up, but a shared store (Supabase or KV) is the fix.
- No per-share expiry or revoke-all; making a card private, or deleting it, is how a link stops working.
- The owner can't see the visits list in the app yet.
