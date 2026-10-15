# The glance rail

A 72 px column on the right of the browser pane, beside the page: one mini card per turn of the open
thread and one per page the pane showed, oldest first with the newest at the bottom like the chat (it
follows new ones down unless you've scrolled up). Each mini is a status dot, the turn's first words (three
lines, clamped) and a relative time ("just now", "2m", "1h"). It's a view over the thread the board already
has, plus one field: each message you send carries `page`. No model calls, no API route.

## Where it lives

- `lib/glance-rail.ts`: the pure projection, `glanceMinis(items, { live, now, visits })` → `Mini[]`
  (`{ id, dot, text, at, time, url?, turn? }`). A user message (or a `!` shell command) is its own mini; everything
  after it until the next one is one agent turn. `id` is `t` + the index of the turn's first item.
- `components/GlanceRail.tsx`: the column. Board passes it to `BrowserPane` as `rail` when a card is open.
  It sits in the same flex row as the page's placeholder, so the native page view (laid over the placeholder)
  keeps clear of it.
- `lib/glance-events.ts`: the two messages between rail and chat.
- `components/ThreadItems.tsx`: each thread row is wrapped in `<div data-turn="t<index>">`.

## Browser history

Each page the pane showed is a mini too, with a globe instead of a dot (accent when it's the page on
screen), labelled short: `glance-rail/index.html#live` for a local file, `localhost:3000/settings` for a site.

- Pages the agent opened come from the thread: each `mcp__browser__open_url` call, placed just above the
  turn that opened it.
- Each message you send is stamped with the page on screen right then: `sendMessage` (`lib/runner.ts`)
  reads it from the index Electron writes on every navigation (`lib/pane-page.ts` over
  `~/.weft/pages/index.json`, `electron/pane-pages.cjs`). So a page a review step opened, or one you
  clicked to, is in the history for good, just before your message, and the message's dot goes back to it.
- Pages you opened yourself (a link, the address bar, Back) aren't in the thread until your next message, so the rail notes them
  in memory for the session (`GlanceRail.tsx`, per card, never saved). A new page counts only while the same
  card stays open; the page a card opens with is its own, not a visit. Each slots in by time, tied to the
  turn before it.
- A page that's already the latest one adds nothing, whoever opened it.
- Every turn and message also carries the page that was on screen then: a turn the last page it showed,
  else the page from before it; a message the page shown as you sent it.
- Click any mini and the chat scrolls to its turn, and the pane goes back to that mini's page if it has
  moved on since (that reopen isn't a new visit).

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

- `glance:scroll-to` (`scrollToTurn(id)`): a mini was clicked. ThreadView scrolls that row to the top
  smoothly, stops following the bottom, and pulses the row for 600 ms.
- `glance:pulse` (`reportTopTurn(id)`): the chat scrolled on its own. ThreadView's scroll handler,
  debounced to 80 ms, finds the first row still showing at the top and reports it when it changed; the
  rail marks that mini active, brings it into view and pulses it. A scroll the rail started doesn't echo back.

## Hiding

Below 980 px of window width the rail is `display: none` (`max-[979px]:hidden`, a media query, no resize
listener), so the chat keeps at least 360 px on a 13" Air. The page placeholder's ResizeObserver then
moves the native view over the freed space.

## Not built

- Pages the server opens itself (the starter and update pages from `lib/glance.ts`) aren't in the thread, so a
  turn that only showed those carries the page from before it.
- Pages you opened by hand and moved on from before sending a message are gone after a restart; the one
  on screen as you sent is kept on the message. In-page `#anchor` changes don't reach the index (it listens
  to `did-navigate` only), so the stamp has the page without its latest anchor.
