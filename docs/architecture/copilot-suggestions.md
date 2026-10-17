# Copilot suggestions (the "chips")

A new copilot chat shows suggested things to ask, in two rows: a few the board itself
fuels (`From your board`), and the fixed `STARTERS` underneath. The board ones are
written by Haiku from what Weft already knows about your work, cached between moves
and refreshed in the background, so the chips are ready the moment you open a new
chat. Each chip is labeled with its project, so one server run covers every project
on the board; switching projects just filters the one reply.

## Overview

- The server runs `boardSuggestions` once per `boardKey`, keeps the result on
  `globalThis`, and returns it for up to `SUGGEST_TTL` (15 min). A card move, a
  new card, or an errored card changes the key, so a new run fires; a move that
  lands during streaming text doesn't.
- A background subscription to the bus (`startSuggestRefresh`, called once per
  server from `prewarm` in `lib/copilot.ts:105`) waits `REFRESH_DELAY` (20 s)
  after a card or card-deleted event, then runs `boardSuggestions` so the chips
  are fresh before you open the lane. The subscriber is one per server.
- The client (`components/CopilotEmpty.tsx`) fetches the cached reply on mount
  and filters it to the board's selected project. Chips with no `project` are
  account-wide and show everywhere. The lane passes its `project` prop; if a
  chat is opened without one, the saved project in the `weft-view` cookie is
  read (`lib/view-prefs.ts`).
- Each chip can list which of the fixed starters it makes redundant (`covers`).
  A starter a visible chip covers is hidden; otherwise all seven starters show.
- When you click a chip, the client POSTs its text to
  `/api/copilot/suggestions` (`recordClick` in `lib/copilot-sources.ts:286`),
  which appends it to `~/.weft/copilot-chips.jsonl` (last 200). The history
  source reads the last 8 so future chips lean your way.

## Key files

- `lib/copilot-suggest.ts`: `boardSuggestions` (the run), `boardKey` (what
  invalidates it), `suggestPrompt` (the Haiku prompt), `parseSuggestions` (the
  reply → chips), `contextText` (the prompt's body), `boardContext` (the
  `?context=1` debug view), `startSuggestRefresh` (the bus subscription),
  `chipCardId` (what card a sent chip was about), `forgetSuggestions` (tests).
- `lib/copilot-context.ts`: tier 1, what the cards themselves say. `urgency`,
  `cardLines`, `recentDone`, `overlaps`, `spend`, `clock`. Pure.
- `lib/copilot-sources.ts`: tier 2 (what Weft has already worked out) and tier 3
  (outside services). `activeProjects` (the up to 5 busiest repo roots),
  `safeRoot` (a card's repo root, worktrees folded in), `SOURCES` (10 named
  sources with per-source timeouts), `gatherSections` (run them all in
  parallel), `readClicks` / `recordClick` (the click log), `GTAG_ONLY`,
  `analyticsTools`, `dependencies`, `statusOf` (cached Vercel/Supabase status
  via the control server). Also `resetSourceCaches` (tests).
- `lib/copilot-setup.ts`: what isn't set up yet. `setupGaps` returns the gaps
  across the projects (account-wide ones first); `projectGaps` is the
  per-project fan-out that calls `vercelGap`, `supabaseGap`, `cloudflareGap`,
  `analyticsGap`. `setup` is the `Source` for the chips' "Not set up yet"
  section, `gapLine` formats a gap as one line, `setupReport` is what the
  copilot's `setup_status` tool returns.
- `lib/copilot-starters.ts`: the 7 fixed `STARTERS` and `VISIBLE_CHIPS` (4).
  `chipsFor(reply, project)` is the client-side filter: one project's chips
  plus account-wide ones (no `project`), top 4, and the starters their own
  `covers` make redundant. When a reply predates per-chip covers it falls back
  to the whole-board `covers`.
- `lib/board-tools.ts`: the copilot's `setup_status` MCP tool (uses
  `setupReport`).
- `lib/copilot.ts:105`: `startSuggestRefresh()` is wired into `prewarm`.
- `app/api/copilot/suggestions/route.ts`: `GET` returns the cached chips (or
  `?context=1` returns the prompt body); `POST` records a click.
- `lib/client-api.ts:199-200`: `api.copilotSuggestions` (GET) and
  `api.copilotChipClicked` (POST).
- `components/CopilotEmpty.tsx`: the empty chat. Takes a `project` prop, falls
  back to `readViewPrefs().project`, shows the board chips above the starters,
  calls `onAsk` and `api.copilotChipClicked` on click.
- `components/CopilotLane.tsx:32-42`: the `project` prop on the lane.
- `components/Board.tsx:737-746`: passes the selected `project` to `CopilotLane`.
- `components/CopilotChat.tsx:136` and `components/ThreadPanel.tsx:200`:
  `CopilotEmpty` with no project; both fall back to the cookie.
- `lib/copilot-suggest.test.ts`, `lib/copilot-starters.test.ts`,
  `lib/board-tools-setup.test.ts`, `components/CopilotEmpty.test.tsx`.

## Data flow

1. `prewarm` (`lib/copilot.ts:105`) calls `startSuggestRefresh()` once. It
   subscribes to `card` and `card_deleted` events on the bus. On every such
   event it waits `REFRESH_DELAY` (20 s) and, if `boardKey` has changed, calls
   `boardSuggestions`. Delta events are ignored — only a move, new card, or
   deletion changes the key.
2. When `CopilotEmpty` mounts it calls `api.copilotSuggestions()` (GET
   `/api/copilot/suggestions`). The route returns `boardSuggestions(listCards())`
   immediately if the cached entry is still on the same `boardKey` and younger
   than `SUGGEST_TTL` (15 min), otherwise it runs.
3. `boardSuggestions` short-circuits for an empty board. Otherwise it builds a
   `Known` from the cards (open card ids, each card's `safeRoot`, project
   basename → root), gathers the sections with `gatherAll` (the 10 named sources
   + `SETUP_SOURCE`, each within its own timeout), wraps them in `contextText`,
   sends `suggestPrompt` to Haiku, and parses the reply with `parseSuggestions`.
4. The cached entry holds the run in flight, so two callers on the same board
   share one Haiku call. A failed run returns `NONE` and is retried on the
   next ask; an empty result clears the cache; a newer run always wins over
   an older empty one that finishes later.
5. `CopilotEmpty` filters the reply with `chipsFor(reply, project)`, top 4
   chips shown, and hides any `STARTERS` they cover. The chip click calls
   `onAsk` (the lane sends it as a copilot message) and POSTs the text so
   `history` and the click log update.
6. `lib/copilot.ts` also calls `chipCardId(text)` when a chip is sent, to
   attach the card it was about to the copilot's prompt.

### What Haiku reads (the `contextText` blocks)

Tier 1 (`lib/copilot-context.ts`):

- `Now: <weekday HH:MM>` (`clock(now)`).
- `Open cards, most urgent first` (`cardLines`): for each open card, up to 30,
  sorted by `urgency` (needs_you / pending → 0, errored → 1, review → 2,
  running → 3, backlog → 4) and then by time in column, the block is column +
  how long, project, title, id, optional stage, optional `remaining`, the last
  reply (truncated to 160 chars), the suggested next message, the open
  question with every option's meaning, or the pending permission, the error,
  and a rate-limit hit.
- `Finished in the last day` (`recentDone`): cards that hit `done` in the last
  24 h, up to 10.
- `Open cards editing the same file` (`overlaps`): files with more than one
  open card, top 5, so a chip can warn about a clash.
- `Spend and plan limits` (`spend`): today's USD across cards active in the
  last day, plus the 5-hour and weekly windows from the most recent
  `card.stats`.

Tier 2 + 3 (`lib/copilot-sources.ts`, each with its own timeout):

| Section | Source | ms | Cached |
|---|---|---|---|
| Uncommitted work | `pile` | 3,000 | per process via `readPile` |
| Code quality and refactor scout | `quality` | 4,000 | `qualityCache`, 30 min per root |
| Your streak and activity | `streak` | 1,000 | – |
| Backlog | `backlog` | 1,000 | – |
| Vault and webhook blanks | `blanks` | 2,000 | – |
| Recent copilot asks and chip clicks | `history` | 1,000 | `readClicks` reads `copilot-chips.jsonl` |
| Vercel deploys | `vercel` | 5,000 | `statusOf`, 60 s |
| Supabase | `supabase` | 5,000 | `statusOf`, 60 s |
| GitHub | `github` | 7,000 | `ghCache`, 10 min per root |
| Analytics | `analytics` | 1,000 | – |

Plus `setup` (`SETUP_SOURCE`, 6,000 ms): the lines from `setupGaps`, so a
chip can offer to link a missing service.

Each source returns `[]` on timeout or throw, so one slow or signed-out service
never holds the others up. Empty sections are left out of `contextText`.

### Setup gaps and `setup_status`

`setupGaps(projects)` (lib/copilot-setup.ts:28) is the entry point. It
parallel-fetches the account view, `gh auth status`, and the cached Vercel +
Supabase status, then returns:

- Account-wide gaps: Weft account when the workspace is set but the user
  isn't signed in, GitHub CLI sign-in, Vercel token for any web project.
- Per-project gaps from `projectGaps(root, ctx)`, which fans out to
  `vercelGap`, `supabaseGap`, `cloudflareGap`, `analyticsGap`. Each gap is
  `{ what, why, where }` and gets a `project: basename(root)` added.

The `analyticsGap` rule: a web project with no analytics tool reads as a gap
("add PostHog or GA4"); one whose only tool is `GTAG_ONLY` (a page tag with no
server API, from `lib/copilot-sources.ts:240`) reads as a "GA4 Data API
access" gap. The gtag-only check is in `lib/copilot-sources.ts` (where
`analyticsTools` lives) and re-used here.

`setupReport(projects)` (`lib/copilot-setup.ts:102`) is what the copilot's
`setup_status` MCP tool (`lib/board-tools.ts:236`) returns: every gap line
from `gapLine`, or "Everything Weft can link for these projects is linked."
when none.

The same gap list also feeds the "Not set up yet" section of the chips, so
Haiku can offer one "link it" chip naming what it would unlock (e.g. "Link
weft to Vercel so I can watch its deploys").

### Caching and TTLs

- `boardKey`: the open cards' `id`, `column`, and whether each has an error,
  sorted. Closed cards, the copilot card, and archived cards are ignored.
  Streaming text doesn't change the key.
- `SUGGEST_TTL = 15 * 60_000` ms (`lib/copilot-suggest.ts:21`). While the
  key matches and the entry is younger, the cached result is returned without
  re-running. After `SUGGEST_TTL` the next ask runs again.
- `REFRESH_DELAY = 20_000` ms: the gap before `startSuggestRefresh` runs
  again after a move, so a flurry of events produces one run.
- Source caches: `qualityCache` 30 min, `statusOf` 60 s, `ghCache` 10 min.
  All live on the server process. `resetSourceCaches` (tests) clears them.

## Important patterns

- One Haiku run per `boardKey`, not per chat, not per project. A chip is
  labeled with its project in `parseSuggestions` — by `cardId` first
  (`cardProject` from `safeRoot(cwd)`), else by the project name Haiku gave
  (looked up in `projects: name → root`). The client filters with
  `chipsFor(reply, project)`. Switching projects costs no new run.
- A chip with no `project` is account-wide and shows in every project
  filter, including `null` (All).
- `chipsFor` keeps at most `VISIBLE_CHIPS` (4) chips for the selected
  project, plus account-wide ones, most urgent first. It hides a starter
  only when a visible chip covers it. A reply whose chips carry no
  per-chip `covers` (predates the project label) falls back to the
  whole-board `covers`; a reply with chips but no `covers` of its own
  doesn't cover anything.
- The reply prompt asks for `MAX_SUGGESTIONS` (4) chips total when there's
  one project, and `PER_PROJECT` (3) per project when there are several;
  `parseSuggestions` caps the chips at `max(MAX_SUGGESTIONS, projects * PER_PROJECT)`.
- Chips must be under `MAX_CHARS` (90); parsed chips longer than
  `MAX_CHARS * 1.5` are dropped. `STARTERS` is sent to Haiku too so its
  `covers` only references real ones.
- `recordClick` is fire-and-forget from the client (`api.copilotChipClicked`
  in `components/CopilotEmpty.tsx:31`); the next chips read it via
  `history`.

## Known edges

- **Git worktree edge.** `safeRoot` (lib/copilot-sources.ts:42) returns the
  card's git toplevel, so a card in a worktree is labeled with the worktree
  path. The board, by contrast, folds worktrees into the main repo
  (`repoCards` in `lib/commit-pile.ts:77`). The chip's `project` is the
  worktree root, so under a project filter (the main repo path) the chip
  doesn't show — it only shows under All (`project: null`).
- A failed Haiku call returns no chips and the cache is cleared; the next
  ask tries again. An empty result also clears the cache so the next ask
  retries.
- The board's `project` prop on the lane is `null` for All; if the lane is
  reached without one (e.g. from `CopilotChat` or `ThreadPanel`), the
  saved project in the `weft-view` cookie (`lib/view-prefs.ts`) is read in
  the browser only — server-side reading would make the board's first
  draw dynamic.
- Click logging is best-effort: the client fires `api.copilotChipClicked`
  without awaiting, so a network error doesn't block the chip from being
  sent as a message.
