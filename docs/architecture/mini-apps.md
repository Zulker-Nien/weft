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
  Escape drops it), Move up, Move down, Copy address, Remove app.

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

## Open and later

- A tile opens its page through the board's `showPage` (`lib/board-helpers.ts`): the board's own pane, `"board"` key.
- Not built: `mcp__browser__save_app` so a thread can offer its page as an app, drag to reorder (Move up/down for now),
  favicons, apps per project.
- Tests: `lib/mini-apps.test.ts`, `lib/mini-app-store.test.ts`, `lib/use-mini-apps.test.ts`, `app/api/apps-route.test.ts`,
  `components/AppsRail.test.tsx` (covers `SaveAppButton` too).
