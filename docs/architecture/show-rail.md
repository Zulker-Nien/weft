# The show rail

A 72 px column on the right of the browser pane, beside the page: one mini card per turn of the open
thread and one per page the pane showed, oldest first with the newest at the bottom like the chat (it
follows new ones down unless you've scrolled up). A page is a picture of what the pane showed, with a short
name and a relative time ("just now", "2m", "1h") under it; a turn is a light row of a status dot, its first
words (three lines, clamped) and the time, so the pictures carry the rail. It's a view over the thread the
board already has, plus one field (each message you send carries `page`) and the page pictures. No model calls.

## Where it lives

- `lib/show-rail.ts`: the pure projection, `showMinis(items, { live, now, visits })` → `Mini[]`
  (`{ id, dot, text, at, time, url?, turn? }`). A user message (or a `!` shell command) is its own mini; everything
  after it until the next one is one agent turn. `id` is `t` + the index of the turn's first item.
- `components/ShowRail.tsx`: the column. Board passes it to `BrowserPane` as `rail` when a card is open.
  It sits in the same flex row as the page's placeholder, so the native page view (laid over the placeholder)
  keeps clear of it. `components/ShowRailItems.tsx` draws a page (`PageTile`) and a turn (`TurnRow`).
- `lib/page-shots.ts` + `app/api/cards/[id]/shots` + `lib/use-page-shots.ts`: the page pictures (below).
- `lib/use-pane-follow.ts` + `followUrl()` in `lib/show-rail.ts`: the pane following the chat (below).
- `lib/show-events.ts`: the two messages between rail and chat.
- `components/ThreadItems.tsx`: each thread row is wrapped in `<div data-turn="t<index>">`.

## Browser history

Each page the pane showed is a mini too, drawn as its picture (accent ring when it's the page on screen, a
globe until it has one), named short enough for 64 px with the full url as its tooltip: `show-rail#live` for
`show-rail/index.html#live`, `plan` for `plan.html`, `/settings` for `localhost:3000/settings`, the host for a
site's home.

- Pages the agent opened come from the thread: each `mcp__browser__open_url` call, placed just above the
  turn that opened it.
- Each message you send is stamped with the page on screen right then: `sendMessage` (`lib/runner.ts`)
  reads it from the index Electron writes on every navigation (`lib/pane-page.ts` over
  `~/.weft/pages/index.json`, `electron/pane-pages.cjs`). So a page a review step opened, or one you
  clicked to, is in the history for good, just before your message, and the message's dot goes back to it.
- Pages you opened yourself (a link, the address bar, Back) aren't in the thread until your next message, so the rail notes them
  in memory for the session (`ShowRail.tsx`, per card, never saved). A new page counts only while the same
  card stays open; the page a card opens with is its own, not a visit. Each slots in by time, tied to the
  turn before it.
- A page that's already the latest one adds nothing, whoever opened it.
- Every turn and message also carries the page that was on screen then: a turn the last page it showed,
  else the page from before it; a message the page shown as you sent it.
- Click any mini and the chat scrolls to its turn, and the pane goes back to that mini's page if it has
  moved on since (that reopen isn't a new visit).

## Page pictures

`lib/page-shots.ts` keeps the newest picture of each page per card in `~/.weft/shots/<card>/`: one file per page
(named by a hash of its url, overwritten by the next capture) and `index.json` from url to file and time.

- **Small.** The pane's capture (a 480 px JPEG from the control server's `/browser/thumb`) is cut to the page's
  top in a 4:5 crop, 144×180 (twice the ~64 px it's drawn at, for Retina), and saved as WebP at quality 55 by
  sharp: 2 to 5 KB a page. One that won't decode saves nothing.
- **When.** The rail (`usePageShots`) waits for the pane's page or the thread to settle for 1.5 s, then posts the
  page to `POST /api/cards/[id]/shots`, which captures it only if the pane still shows that url and it wasn't
  captured in the last 8 s (`FRESH_MS`), and answers with the card's url → src map. So a page is pictured as it
  first paints and again as a turn updates it, while the card is open. With no page in the pane it only reads
  the map (`GET`).
- **Served** by `GET /api/cards/[id]/shots?img=<name>&v=<time>` as `image/webp`, cached for good: each capture
  has its own `v`. Names are checked against the file pattern, and the card id is made folder-safe.

## Dots

The theme's own tokens, so every scene and light mode reads right: `ok` (finished), `warn` (waiting: the
newest turn while the thread runs or waits on you, or a turn that ended on a question, an AskUserQuestion,
an unanswered permission or `column=needs_you`), `danger` (an error result, or a turn whose last step was a
failed tool call; a failure it recovered from stays green) and `faint` (your message).

## Turns with no prose

A turn with only tool calls names its first one: `Bash · pnpm test` (command cut to 24 characters),
`Edit · lib/foo.ts`, `Read · lib/foo.ts`, `Grep · pattern`; another tool is just its short name. A message
that is only an image reads `📎 attachment`. Nothing draws blank.

## Rail ↔ chat

Rail and chat are both React in the board window, so they talk with two window events, not Electron IPC:

- `show:scroll-to` (`scrollToTurn(id)`): a mini was clicked. ThreadView scrolls that row to the top
  smoothly, stops following the bottom, and pulses the row for 600 ms.
- `show:pulse` (`reportTopTurn(id, bottom)`): the chat scrolled on its own. ThreadView's scroll handler,
  debounced to 80 ms, finds the first row still showing at the top and reports it, and whether the chat is at
  its end, when either changed; the rail marks that mini active, brings it into view and pulses it. A scroll
  the rail started doesn't echo back.

## The pane follows the chat

Once the chat has stopped on a turn for 350 ms (`FOLLOW_MS`, so a fling doesn't load every page on the way),
`usePaneFollow` puts the pane on the page that was on screen for the turn at its top (`followUrl`), as a reopen,
not a new visit. Back at the end of the chat it returns to the newest page, but only if following moved it: a
page Weft opened itself (the starter or update page) isn't in the thread, and opening a card (which scrolls to
the end) leaves it alone. A turn whose page is already on screen moves nothing.

## Hiding

Below 980 px of window width the rail is `display: none` (`max-[979px]:hidden`, a media query, no resize
listener), so the chat keeps at least 360 px on a 13" Air. The page placeholder's ResizeObserver then
moves the native view over the freed space.

## Not built

- Pictures are taken only while the card is open (a pane off screen may capture empty), and a deleted card's
  `~/.weft/shots/<card>/` stays behind.
- Pages the server opens itself (the starter and update pages from `lib/show.ts`) aren't in the thread, so a
  turn that only showed those carries the page from before it.
- Pages you opened by hand and moved on from before sending a message are gone after a restart; the one
  on screen as you sent is kept on the message. In-page `#anchor` changes don't reach the index (it listens
  to `did-navigate` only), so the stamp has the page without its latest anchor.
