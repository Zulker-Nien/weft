# Threads and sessions

`lib/runner.ts` is the heart of Weft. Each active card has a long-lived CLI subprocess that
the SDK drives through a streaming `Inbox`. The file covers the per-card session lifecycle,
the permission and question flow, and the BOARD STATUS handling. Picking up existing Claude
Code sessions lives in `lib/import.ts` and `lib/transcript.ts` (see the end of this doc).

## Per-card session lifecycle

### `Inbox` and `query()`

`Inbox` (`lib/runner.ts`) is an `AsyncIterable<SDKUserMessage>` fed by `push()`. The
SDK's `query()` consumes it as the prompt, so a single CLI process keeps running
between turns and each user message is a new `SDKUserMessage` on the same iterator.
`close()` ends the input and lets the process exit.

`open()` starts a session, registers it in the `sessions` map (kept on `globalThis`, so
every API route shares it), and returns the running `Session`. `drive()` (`lib/runner.ts`) calls `query()` with:

- `cwd`: the card's folder
- `resume`: the existing `sessionId` (or unset for new cards)
- `forkSession`: true when Weft continues a session that's open elsewhere
- `permissionMode`: `default` / `acceptEdits` / `auto` / `bypassPermissions` (`MODES` in `lib/types.ts`)
- `systemPrompt.preset: "claude_code"` with `BROWSER_PROMPT` + either `threadPrompt()`
  (board threads) or `COPILOT_PROMPT` (the copilot)
- `mcpServers`: copilot gets `browser` and `board`; board threads get just `browser`
- `plugins`: board threads load `plugin/` (`PLUGIN_DIR` in `lib/skills.ts`), Weft's own skills,
  so `/weft:done` and `/weft:commit` work in every thread. The packaged app ships the folder in
  `Resources/plugin` and passes `WEFT_PLUGIN_DIR` (`electron/server.cjs`)
- `canUseTool`: trusted tools auto-allow (`isTrustedTool`); everything else is routed to
  `askUser` so the card can prompt the user
- `pathToClaudeCodeExecutable`: `pukuPath` (looked up via `/usr/bin/which puku-cli`)
  for the puku backend, `undefined` for Claude Code
- `allowDangerouslySkipPermissions`: `true` for non-copilot Claude Code cards
  (so a card can switch to `bypassPermissions` later, including a spare it takes
  over); omitted for the puku backend because puku-cli's CLI rejects the flag,
  and omitted for the copilot card

### Warm sessions and keep-alive

`scheduleIdle()` (`lib/runner.ts`) starts a timer for `keepAliveMinutes()` minutes
after the last message. Setting `keepAliveMinutes` to `0` (the default) means the
session stays open until the app quits. Picked-up Claude Code sessions cap at 10 idle
minutes so Weft doesn't hold a session the Claude app might reopen.

`warmUp(cardId)` (`lib/runner.ts`) opens the CLI without sending anything. It's a
no-op for picked-up cards and for cards whose `cwd` no longer exists.

`isStale()` marks a session stale when its `ended` flag is set, or when it is idle and its
`BUILD` fingerprint no longer matches (see below). `currentSession()` closes and replaces a
stale session on next use, and `closeWhenIdle()` closes one after the keep-alive time.

### Spare CLIs per project

`ensureSpare(cwd, backend)` (`lib/runner.ts`) keeps up to `MAX_SPARES` (3) idle
CLI processes keyed by `backend|cwd`. `adoptSpare()` (`lib/runner.ts`) hands a
spare to a new card, switches it to the card's permission mode, model and effort
(`switchSpare()` in `lib/spare-switch.ts`), marks the card `warm: true`, and immediately
starts a fresh spare for that folder.

### Commit and PR attribution

A board thread signs its commits "Co-Authored-By: <model> on Weft" and its PRs "Generated with
Claude Code on Weft". `signAsWeft()` (`lib/attribution.ts`) passes the CLI's `attribution` setting
through `query.applyFlagSettings`, which replaces Claude Code's default lines, once the model is known:
at the session's `init` message (the card's model, else the one the CLI reports) and again when a spare
takes a card with a different model. `modelName()` turns an id like `claude-opus-5-5[1m]` into
"Claude Opus 5.5"; an alias or a puku model reads "Claude". The copilot doesn't commit and puku-cli has
its own attribution, so neither is signed.

Spares open in the default permission mode (`defaultPermissionMode()` in `lib/settings.ts`, Auto unless
changed in Settings), the same mode `POST /api/cards`, the New thread dialog and the copilot's `create_card`
start a card in, so adopting one rarely needs a mode switch. The dialog's effort starts at High and then
follows the last card's (`weft.effort` in localStorage).

`prewarm()` (`lib/copilot.ts`) runs once per server start: it starts the Claude Code
session sync, ensures the copilot card and warms it, and starts a spare in the most recent
project (or the folder of the first non-copilot card).

### BUILD fingerprint

`BUILD` (`lib/runner.ts`) is a SHA-1 of `[drive, handle, askUser, settle,
sendMessage].map(String).join("\n")`. Each API route can load its own copy of
`runner.ts`, so the fingerprint has to come from the code, not a random value at load
time. Idle sessions whose `build` doesn't match are replaced on next use (`currentSession()`,
`warmUp()`, `ensureSpare()`), which is how dev-mode code reloads swap out stale CLIs. A busy
session is never replaced mid-turn.

### Queued messages (automations)

`queueMessages(cardId, texts)` (`lib/runner.ts`) runs each text as its own turn, in order. It
sends the first right away when the card is idle; the `result` handler sends the next once the
turn ends, unless the turn was stopped or failed (the queue is dropped) or ended in `needs_you`
(the queue waits for the turn after your reply). A CLI that dies mid-turn drops it too.

Board automations use it: `messagesForMove()` (`lib/automations.ts`) returns `/<skill>` messages
for your own moves to Review or Done, which `PATCH /api/cards/[id]` queues. "A thread starts"
rules don't queue anything; `firstMessage()` appends "Start by using the /x skill" to the card's
prompt, used by every path that starts a Backlog card (`POST /api/cards`, the PATCH to running,
the copilot's `start_card`). The copilot's `move_card` never runs automations.

### Scheduled messages (send later)

The reply box's clock button (`components/SendLater.tsx`, Alt+Enter) saves a message on the card
as `card.scheduled` (`ScheduledMessage[]`, soonest first) through `POST /api/cards/[id]/scheduled`;
`DELETE` takes one back. The server sends them, not the browser: `startScheduler()`
(`lib/scheduler.ts`, started from `prewarm()`) checks every 15 s and calls `sendUserMessage()` for
each card's first due message, so it goes out with the thread closed, and one that came due while
Weft was shut goes on the first check after the next start. A card mid-turn keeps its message until
the turn ends. A failed send puts the reason in `card.error` and is not retried.

The default time is the plan's next 5-hour reset plus a minute (`RESET_GRACE_MS`), read by
`nextFiveHourReset()` (`lib/schedule.ts`) from the latest `stats.fiveHour.resetsAt` any Claude card
has seen (the figure the status bar shows). `nextWeeklyReset()` reads `stats.sevenDay` the same
way, with the highest share used any card saw at that reset; `planResets()` gathers both for the
reply box. When the weekly window is at `WEEKLY_NEAR` (90%) or more, `sendLaterOptions()` adds "At
the weekly reset" (also plus `RESET_GRACE_MS`) after the 5-hour one; at 100% the weekly limit is
what stops the thread, so it goes first and becomes the Alt+Enter default. Puku threads, and Claude
ones with no known reset, get "In 1 hour" first; "Tomorrow morning" (9am) and a date-time picker are always there. The copilot
can't schedule. The card shows the next time as a clock badge in its footer.

### Archiving after Done

Moving a card to Done also calls `archiveWhenIdle()` (`lib/runner.ts`): with no queued or running
turn it sets `card.archived` at once; otherwise the id goes in `archiveAfter` and the `result`
handler archives it (`column: "done", archived: true`) once the queue drains. A stopped or
errored turn drops the id, leaving the card in Done unarchived. `sendMessage()` clears `archived`,
and a move to any other column does too. The board hides archived cards until "Show N archived"
in the Done header (`components/Board.tsx`). Archived cards don't count toward the header's
"need you" and "running" totals or a project chip's dots (`summarizeProjects` in `lib/board-view.ts`),
so a hidden card never shows a count you can't find.

## Permissions and questions

### Changing a card's mode

`PATCH /api/cards/:id` with `{ permissionMode }` validates it against `MODES` and calls
`setPermissionMode(cardId, mode)` (`lib/runner.ts`), which saves it on the card and, when the card
has an open CLI, calls `query.setPermissionMode(mode)` the way `adoptSpare()` does, so it applies
mid-turn. `bypassPermissions` is refused for the copilot and puku cards, whose CLIs start without
`allowDangerouslySkipPermissions`. The thread header has a small `ModePicker`
(`components/ModePicker.tsx`, the same select the new-thread dialog uses) and the card's
right-click menu lists the modes with the current one ticked (`mode:<id>` in `lib/card-menu.ts`).
A request already waiting on the card still needs an answer after a switch.

### `canUseTool` -> `askUser` -> `settle`

When the SDK asks to use a tool, `canUseTool` either auto-allows (browser tools, and
the copilot's read-only board tools) or hands the request to `askUser()`
(`lib/runner.ts`). `askUser` records a `permission` thread item, pushes a
`Pending` onto `session.pending`, and returns a `Promise<PermissionResult>` that
resolves only when the user answers.

`answerPermission(cardId, allow, answers, pendingId)` (`lib/runner.ts`) is the API
surface. `pendingId` ties the answer to the specific request the user saw; without it
the oldest pending request is answered. The user picks `allow`/`deny` (or fills in
`answers` when it's a question); `settle()` (`lib/runner.ts`) replaces the
permission thread item with the decision, moves the card back to `running` if no more
requests are queued, and resolves the SDK's `Promise<PermissionResult>` with
`{ behavior: "allow", updatedInput }` (and the answers) or `{ behavior: "deny" }`.

### `AskUserQuestion` -> `QuestionForm`

`readQuestions()` (`lib/runner.ts`) sanitizes the SDK's `questions` array
(question, header, multiSelect, options with label/description). The card shows them
through `QuestionForm.tsx`. The user answers with one label (or several for
`multiSelect`) plus a free-text "other" per question, or skips. Answers become
`Record<question, "label, label">` and are passed as `updatedInput.answers` to the
SDK on allow.

The panel (`ThreadView.tsx`) is capped at 60% of the window height, and the form
scrolls only its questions: Send answer and Skip stay pinned below them, so a long
list never pushes them off screen.

## BOARD STATUS protocol

The thread prompt (in `lib/settings.ts`, editable as "Thread instructions") tells
each agent to end every reply with:

```
BOARD STATUS: column=<needs_you|review|done> | stage=<...> | remaining=<...>
```

`lib/status.ts` (`extractStatus`) finds the line, even when wrapped in backticks or
emphasis and in any letter case. The column is normalized to snake_case and must be
`needs_you`, `review`, or `done` (anything else is ignored), `remaining=none` becomes
`undefined`, and the line is stripped from the text shown on the card. `handle()` in
`lib/runner.ts` updates the card's stage and remaining from each assistant message as the
turn progresses, and applies `column` on the `result` message: the status line in the final
result wins, with the last one seen during the turn as a fallback. A stopped or failed turn
always lands in `review`. `lastLine` is the first non-empty line of the assistant's text or
result summary.

## Auto-login

When a turn ends or `drive()` throws with text matching `isNotLoggedInError`
(not-logged-in, invalid API key, oauth expired, authentication_error), `needLogin()`
(`lib/runner.ts`) moves the card to `needs_you`, adds the card id to
`loginWaiters[backend]`, and calls `startLogin(backend, onDone)`.

`lib/login.ts` runs `<cli> auth login` in the background, strips ANSI/OSC8, finds the
login URL (an OSC8 hyperlink target, falling back to a plain `https://` URL), and publishes
a `login` view to the board (the `LoginDialog`). When the process exits it checks
`<cli> auth status --json` once: logged in means done. If the CLI demanded a real TTY,
`openLoginInTerminal()` runs an AppleScript that opens Terminal with the login command, then
polls `auth status` every 3 seconds (up to 10 minutes) until it reports `loggedIn: true`. On success, `retryAfterLogin(backend)` resets
`loginWaiters` and replays the last user message on each waiting card via `retry()`
(`lib/runner.ts`), which calls `endSession` then `sendMessage` with `echo: false`.

## The copilot

`lib/copilot.ts` creates a card with `id: COPILOT_ID` ("copilot"), `role: "copilot"`,
`cwd: os.homedir()`, `backend: "claude"`. The card is filtered out of the board
(`listCards().filter((c) => c.role !== "copilot")` in the cards route) but its thread
still runs through `runner.ts`. `resetCopilot()` ends its session, clears its
thread, and re-warms it.

`lib/board-tools.ts` registers the `mcp__board__*` MCP server used only by the
copilot: `list_cards`, `read_thread`, `create_card`, `move_card`, `stop_card` are in
`SAFE_BOARD_TOOLS` and auto-allow through `isTrustedTool()`. `start_card`,
`send_message`, and `answer_permission` are NOT in the set, so they reach the user
through `canUseTool` -> `askUser`; `describeBoardTool()` makes the prompt readable
("Start "Weft desktop app"", "Reply to "…": …", "Allow Bash on "…""). The
`start`, `stop`, `answer`, `isBusy` actions are passed in as `BoardActions` to
`boardMcpServer()` to avoid a circular import.

The copilot's CLI also gets `browserMcpServer()`, so it shares the same `mcp__browser__*`
tools as every other thread.

## Picking up existing Claude Code sessions

`lib/import.ts` reads `~/.claude/projects/<project>/*.jsonl` and the SDK's
`listSessions({ includeProgrammatic: false, limit: 10_000 })`. Once per server start
and every `SYNC_EVERY_MS` (60s) it calls `runSync()`:

- For each session: skip if the id is in `dismissedSessions()` (from
  `lib/settings.ts`) or if `session.cwd` is under a temp dir
  (`os.tmpdir()`, `/tmp/`, `/private/tmp/`, `/private/var/folders/`).
- `lastActivity(file)` reads the last 256KB of the `.jsonl` and finds the last
  `"timestamp":` field; cached by `mtimeMs` because file times are unreliable.
- `parseTitle()` maps a "STAGE - title" custom title through `STAGES`
  (Planning, Pre-build refactoring, First shot, Going deeper, Polishing, Post-build
  refactoring, Cleaning up, Done). `columnFor()`: `Done` stage -> `done`, any other
  stage -> `review`, otherwise: `Date.now() - lastActivity < 3 days` -> `review`,
  else `done`.
- New sessions become cards with `source: "claude-code"`, in the permission mode the session last
  ran in (`sessionMode()`): the last `"permissionMode"` in the file's tail (user messages and
  `permission-mode` records carry it), else in its first 256KB, else `permissions.defaultMode` from
  `~/.claude/settings.json`, else `default`. `toPermissionMode()` (`lib/types.ts`) maps modes Weft
  doesn't run (`plan`, `dontAsk`) to `default`. Cards picked up before this keep their mode; change
  it from the thread header or card menu. For existing picked-up cards, a
  newer last message or a new title from outside Weft updates the card (and moves it) unless
  Weft has that thread open (`warm`); cards Weft created, and cards that continued a session
  as a copy (`forkedFrom`), are left alone.
- `openElsewhere` comes from `openSessions()`: `/bin/ps` parsed for
  `--resume=<uuid>` / `--session-id=<uuid>`, plus Claude Code's own list of running sessions in
  `~/.claude/sessions/<pid>.json` (the only place a session the Claude app started fresh shows
  up). Entries whose pid isn't running, and Weft's own children, are ignored.
- Live sessions move on their own. That list reports each session as `busy`, `idle`, or
  `waiting`; `liveColumn()` puts busy ones in Running and waiting ones (a question or permission
  prompt in the other app) in Needs you, with a status line saying so. Without a report, an
  unfinished turn at the end of the session file (`midTurn()`: a prompt, tool call, or tool result
  after the last final reply) counts if the session is open or changed in the last two minutes.
  `checkLive()` re-checks every 5 seconds between full syncs, re-reading only changed files.
  `liveCards` remembers which cards the sync moved, so it moves them back when the turn ends and
  leaves cards the user put in those columns alone.

When a card is opened, `loadTranscript(card)` calls `getSessionMessages(sessionId)`
and replaces its thread with `transcriptToThread()` from `lib/transcript.ts`, keeping the
last 400 items. That function drops user messages the person didn't type (`is_meta`,
`isCompactSummary`, origin kinds in `NOT_TYPED`, task notifications, interruptions),
strips embedded `<system-reminder>` and `<user-prompt-submit-hook>` sections, turns
`<bash-input>` into `! …`, shows slash commands the user typed but not completed local
commands (like `/clear`) or their output, and attaches each `tool_result` to its `tool_use`
by id. Images go through `lib/thread-media.ts` into the attachments folder: screenshots in
tool results become the tool item's `images`, images pasted into Claude Code become inline
`![…](path)` refs in the user's text, and local files the agent shows with `![…](path)` are
copied in and the ref rewritten. `transcriptAt` records what was read, so unchanged sessions aren't re-read. A card
Weft has open (`warm`) keeps its own live thread.

`activeElsewhere()` in `lib/runner.ts` decides whether writing to a picked-up session
would collide with another app. It says yes when the session changed outside Weft in the
last 10 minutes (`lastActivity` is more than 5 seconds past `lastWeftTurn`), or when it is
open in another app right now (`isOpenElsewhere`). Cards that already continued as a copy
never do. When it says yes, `sendMessage()` opens the CLI with `forkSession: true` and stores
`forkedFrom: <original sessionId>` on the card, so the original session is never written to
by two apps.

`lib/env.ts` (`cliEnv()`) builds the environment for every CLI Weft starts: it removes the
`CLAUDE_CODE_*`, `CLAUDE_AGENT_SDK_*`, and related variables inherited from a Claude session
Weft was launched from, and sets `CLAUDE_CODE_ENTRYPOINT=sdk-ts`, so Weft's own sessions
don't appear in the Claude app's session list.

## Status strip

`components/StatusStrip.tsx` shows a thread's numbers under the reply box (`ReplyBox`): project folder and branch, model, context left, prompt cache warmth, tokens, changed lines, and the plan's 5-hour and weekly quota with reset times. The data is `card.stats` (`CardStats` in `lib/types.ts`), written by `lib/runner.ts`:

- After each turn, `turnStats()` fills the model, tokens and context fill from the result's `modelUsage` and the last main-agent request's usage, and `changedLines()` / `gitBranch()` read `git diff HEAD --numstat` and the branch from the folder.
- **Prompt cache.** `handleAssistant()` runs each main-agent request's usage through `cacheAfter()` (`lib/turn.ts`) into `session.cache` (`CacheState`: request time, lifetime, cache-hit share, size in tokens); `turnStats()` saves it as `stats.cache`. The lifetime is read from what the request wrote (`ephemeral_1h_input_tokens` means an hour, `ephemeral_5m_input_tokens` five minutes). The strip's `Cache` chip counts the minutes left (`cacheMinutesLeft()` in `lib/format.ts`, ticking on `useNow`) and turns to `cache:cold <size>` once it lapses: the next message resends that many tokens at full price instead of about a tenth. The size is also the context fill, so it replaces the old `contextTokens`.
- `refreshLimits()` calls the SDK's experimental `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET` at CLI init and after each result to get the 5hr/7d windows (null on API-key logins). `rate_limit_event` messages update the same fields when they carry a utilization. A failure leaves the limits blank.
- Quota is account-wide, so the bottom bar takes it from the most recently updated card via `latestLimits(cards)` in `lib/board-view.ts`, which returns the latest card's full `CardStats` plus its `cwd` and `backend` (`(CardStats & { cwd: string; backend: Card["backend"] }) | undefined`) so the bar can show "last thread: <folder> [model] 5hr/7d" when no card is open. `components/Board.tsx` derives `footerStats`, `footerCwd` and `footerBackend` from that result and passes them down.
- `StatusStrip` takes an optional `backend?: Backend` prop. When `backend === "puku"`, the model label uses puku purple (`text-puku`) instead of warn amber, and when no `stats.model` is reported puku still renders a `[puku]` label with a "Backend: puku-cli" tooltip so the strip isn't blank.
- Native `title` tooltips don't show in the desktop app, so `Tip` draws its own bubble in a portal, clamped to the window.

## Review tour

A thread that finishes work for review ends its reply with a fenced `weft-review` JSON block (the instruction is `REVIEW_PROMPT` in `lib/review.ts`, appended to every board thread's system prompt in `drive()`). `lib/runner.ts` strips the block from the visible text and saves the parsed plan on `card.review`: `url` (where the app runs), `dev` (the command that starts it), and `steps`.

While the card is in Review, `components/ReviewPanel.tsx` sits at the bottom of the thread, in place of the reply box (`footer` and `replaceReply` on `ThreadView`). A card with no plan keeps its reply box with a "Build review tour" strip above it. It shows one step at a time with what to look for, "Looks good, next" and previous/next buttons, an **Open browser** button, and a feedback box that sends the note to the thread. A new plan restarts the tour.

- **A step's page** (`stepUrl` in `lib/review.ts`): its `path` as a full URL, an absolute media/file path (opened as `file://`), or a path on the plan's `url`. A step with no `path` uses the first URL or file path in its `look` text, then the plan's `url`. A plan with no `url` falls back to the local app the thread mentioned most.
- **Dev server** (`lib/devserver.ts`, `app/api/cards/[id]/dev/route.ts`): when the plan has `dev` and `url`, the tour asks the server to start the command in the card's folder unless the url already answers, polls its status every 3 s, and shows running/starting/crashed with Start/Restart buttons. Servers Weft started are stopped when Weft exits.
- **Self-check**: the `weft:preview` skill (`plugin/skills/preview`) starts the server, confirms the page renders, and gives the url and start command for the plan.

## Browser per card

The browser pane keeps one page per card (`views` in `electron/browser-pane.cjs`, keyed by card id; `"board"` when no card is open). `Board` calls `browser.setActive(selectedId)`, so opening a card shows its page (if it has one) and closing the card hides the pane. `browser.open(url, cardId)` from the board activates that card's browser; agent tools (`browserMcpServer(() => session.cardId)` in `lib/browser-tools.ts`) pass the card id to the control server and load into their own card's browser without taking over the screen. `browser.prune` closes the browsers of deleted cards.

`BROWSER_PROMPT` also tells every thread to show something current there on every turn, quick answers included: with no app page yet, it renders its work (commits, plans, diffs, test runs) as an HTML file under `/tmp/weft-show/` and opens it with `open_url`.

## Prompt search

The command palette (Cmd+K) searches the prompts the user wrote. `lib/search.ts` keeps a SQLite FTS5 index (`~/.weft/search.db`, via `node:sqlite`; the type shim is `node-sqlite.d.ts`) with one row per typed prompt. It indexes every Claude Code session file from `sessionFiles()` in `lib/import.ts` (keyed `session:<id>`) and every Weft thread file in `~/.weft/threads` (keyed `card:<id>`). `typedPromptOf()` in `lib/transcript.ts` picks the typed text out of a raw `.jsonl` record, with the same filtering as `transcriptToThread`. Session files are append-only, so the `sources` table stores a byte offset per file and each pass reads only the new lines; thread files are re-read when their mtime changes. `startSearchIndex()` (called from `prewarm()`) runs a pass at start and then every minute.

The index covers everything, but `searchPrompts()` only returns prompts from cards on the board: it maps each card to its `card:` and `session:` keys, passes them to the query as a JSON list, and leaves out the copilot. Results are ranked by bm25, de-duplicated per card (a Weft-run card is in the index under both keys), and capped at 2 prompts per card and 20 cards. Every query word must match and the last is a prefix. `GET /api/search?q=` returns `{ hits, indexing }`; `indexing` is true until the first pass over the sessions has finished. Snippets mark matched words with `\u0001`/`\u0002`, which `CommandPalette` renders in bold under a "Prompts" group. Choosing a hit opens its card.
