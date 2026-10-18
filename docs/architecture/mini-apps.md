# Mini apps

A mini app is a page from the browser pane, saved so it is one click away on the left rail. A thread's HTML page in
`~/.weft/show`, a dashboard, a dev server, any site: if the pane can show it, it can be an app.

## Where it shows

- **Rail tiles.** `components/AppsRail.tsx` draws one tile per app under the 🖥 Services icon in `components/LibraryRail.tsx`,
  behind its own divider. With no apps it renders nothing, not even the divider. `Board.tsx` passes the pane's current URL
  down as `paneUrl` (unset outside the desktop app, which also hides the tiles); the tile for the page on screen gets a ring.
- **Save button.** `components/SaveAppButton.tsx` is the grid button in the pane's toolbar (`components/BrowserPane.tsx`).
  It saves the page under its title (`appNameFrom`: title, else host, else the file's name). On a page that already is an
  app it is lit and removes it. It is disabled for anything `cleanAppUrl` refuses (about:, data:, weft:).
- **Tile.** The name's first grapheme on a steady hue (`tagHue`), or the emoji the name starts with (`appGlyph`).
- **Right-click** (`appMenu`, popped through `window.threadboard.popupMenu`): Open, Rename… (in place, Enter keeps it,
  Escape drops it), Share…, Move up, Move down, Copy address, Remove app.
- **My mini apps.** `components/LoomApps.tsx` is a section on the Loom dialog's You tab (`components/LoomDialog.tsx`), under
  your wefter card: one row per app (its tile, name, and where it lives, or how it's shared), a click opens it in the board's
  pane (`showPage`) and closes the dialog, and its share button opens the Share dialog. With no apps it says how to save one.

## Data flow

1. `lib/mini-apps.ts`: pure model. `MiniApp {id, name, url, addedAt}`, `cleanAppUrl` (http, https, file), `cleanAppName`
   (40 characters), `appFor` (the app a page is: same address ignoring `#hash`, else the closest saved app it sits inside),
   `upsertApp` (saving a saved page renames it), `moveApp`, `appMenu`.
2. `lib/mini-app-store.ts`: the list and its order in `~/.weft/apps.json`, read when used (not at import).
   `saveApp`, `updateApp` (`name` and/or `to`), `removeApp`; a saved page saved again without a name is returned unchanged.
3. `app/api/apps/route.ts`: GET (no write header), POST `{url, name?}`, PATCH `{id, name?, to?}`, DELETE `{id}`;
   `lib/guard.ts` host check, errors as 400.
4. `lib/use-mini-apps.ts`: one list in module memory behind `useSyncExternalStore`, shared by the tiles and the save
   button so a save shows on the rail at once. Every change goes to the server and then reloads the list from it.
   The list also reloads when the window gets focus, so an app saved elsewhere (a thread calling the route) shows up.

## Sharing an app

**Share…** (the tile's right-click menu, or the share button in My mini apps) opens `components/ShareAppDialog.tsx`: the
same `@aimhuge/share` dialog and modes as a card's link (sharing.md), minus editing, for one link, `weft.zip/a/<id>`.
Its sign-in and no-workspace parts are `components/ShareParts.tsx`, shared with `components/ShareCardDialog.tsx`.

A mini app lives on the Mac, not in cloud sync, so the share row carries its own copy of what to show (`lib/app-share.ts`):

- **A local page** (`file://`, usually a `~/.weft/show` page) is uploaded to `weft-blobs/<org>/<sha>` by the blob store,
  under the same path rules as cloud sync (`lib/blob-paths.ts`: home only, never the vault or a secret). The row's `page` is
  `blob:sha256:<hex>#hash`. Each time the dialog opens, a changed file is uploaded again and the row moved to it, as is a
  renamed app, so the link shows the page as of the last time you opened Share….
- **A public https site** is stored by address and framed as is, with an Open link for sites that refuse framing.
- **Anything only this Mac reaches** (localhost and `.local` hosts, LAN addresses, plain http, a file Weft won't upload)
  answers `unshareable` with the reason, and the dialog says it instead of the fields.

The dialog draws at once from `app.share`, the last answer kept on the app in `apps.json` (`rememberAppShare`), which
also lets My mini apps mark the shared ones. Removing an app deletes its share row (`dropAppShare`, best effort).

On weft.zip, `app/a/[id]/page.tsx` runs the gate (`lib/app-share-access.ts`, the same `gateVerdict` as a card's link in
`lib/share-access.ts`) and draws `components/share-view/SharedApp.tsx`: a thin header and the page full-window. A blob is
framed from `app/api/a/[id]/page`, which serves only the blob the row names, sandboxed and with key-shaped text masked
(`lib/share-page-serve.ts`, shared with the card's page route). The email and password gates post to
`app/api/a/[id]/unlock` (`lib/share-unlock.ts`: the same rate limit, pass cookie and off-Vercel refusal as a card's).

Schema: `supabase/migrations/20261018150000_app_shares.sql`. `cloud_app_shares` is one row per (workspace, sharer, app);
members read it without `password_hash`, only the sharer writes, and the database fills `created_by`.
`cloud_app_share_visits` holds who got through an email gate, readable by the sharer only.

## Open and later

- A tile opens its page through the board's `showPage` (`lib/board-helpers.ts`): the board's own pane, `"board"` key.
- Not built: `mcp__browser__save_app` so a thread can offer its page as an app, drag to reorder (Move up/down for now),
  favicons, apps per project. A shared page's own pictures and scripts by relative path don't load remotely (only the one
  file goes up), the link doesn't follow edits until the dialog opens again, and the visits list isn't shown in the app.
  The card's unlock route (`app/api/s/[id]/unlock`) still has its own copy of `lib/share-unlock.ts`'s steps until the
  pentest's F-6 change there is committed.
- Tests: `lib/mini-apps.test.ts`, `lib/mini-app-store.test.ts`, `lib/use-mini-apps.test.ts`, `app/api/apps-route.test.ts`,
  `components/AppsRail.test.tsx` (covers `SaveAppButton` too); sharing: `lib/app-share*.test.ts`, `lib/share-unlock.test.ts`,
  `lib/share-page-serve.test.ts`, `app/api/apps-share-route.test.ts`, `app/api/a/[id]/*/routes.test.ts`,
  `components/ShareAppDialog.test.tsx`, `components/LoomApps.test.tsx`.
