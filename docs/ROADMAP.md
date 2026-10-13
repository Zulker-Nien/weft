# Weft roadmap

Weft is a desktop kanban board where every card is a Claude Code or puku-cli thread, with a shared browser pane and a copilot that can run the board.
This file lists the features we still need, grouped by area, one line each, so we can pick work and argue about priority in one place.
Tags: `Now` is being built this session; `P1` is next and high value; `P2` is clearly useful; `P3` is later or speculative.

## Top 10 next

1. **Diff view in Review** — show what a card changed since it started, so reviewing a finished turn doesn't mean switching to an editor.
2. **Copilot acts on its own** — the copilot now hears what finished, failed, or needs you with each of your messages; next, let it start a turn when that happens instead of waiting to be asked.
3. **Markdown in threads** — render agent replies with headings, code blocks, and tables instead of plain text.
4. **Always-allow rules** — "allow always for this card / this project" on permission prompts, so the same `npm test` doesn't ask twenty times.
5. **Commit, push, and open a PR from a card** — finish the loop from Review without leaving the board, and keep the PR link on the card.
6. **Browser tab per card** — each card gets its own tab in the pane, so two agents testing two apps don't navigate over each other.
7. **Import existing CLI sessions** — turn threads started in a terminal (`~/.claude/projects`, `~/.puku-cli/projects`) into cards that resume them.
8. **Queue a reply while running** — let you type the next instruction while a turn is working; it's sent when the turn ends.
9. **Concurrency cap and run queue** — limit how many cards run at once and start the rest from Backlog in order, so a batch of cards doesn't swamp the machine or the rate limit.

## Board and organization

- `Now` **Projects bar** — a bar above the columns listing the project folders in use, to filter the board to one or more projects and sort cards by activity or age.
- `Done` **Recently changed in ⌘K** — the palette opens on the cards that moved column in the last day, latest move first (`recentMoves` in `lib/board-view.ts`, stamped as `columnAt` by `lib/store.ts`).
- `Done` **Bigger ⌘K with the last output** — the palette is 840px wide with larger type; each card row shows its last line of output (or error) and how long ago it changed (`preview` and `when` on `PaletteItem`, filled in `components/board-palette.ts`).
- `Now` **Filter quick-open** — the filter box shows its `/` key, lists the top matching cards as you type (Enter opens one) and hands the text to the ⌘K palette.
- `P1` **Order within a column** — drag to reorder cards inside a column and keep that order, so the top of Backlog is what runs next.
- `P1` **Archive instead of delete** — Done cards move to a searchable archive after N days; today delete also removes the card's thread view for good.
- `P1` **Undo** — a short undo toast after a move, stop, or delete, since a misplaced drag or delete is easy to make and hard to fix.
- `Done` **Archive keys** — `Shift+A` archives the focused card (else the open thread) and steps focus to the next one, `Shift+E` archives the Done column, and `Z` or the toast's Undo restores the last archive (`lib/archive.ts`). Archive is the first action with undo.
- `Done` **Card actions menu** — right-click a card for a native, one-click menu (`lib/card-menu.ts`): open, rename, start, move, stop, run Weft skills, dev server, new thread here, reveal folder, copy path or resume command, archive, delete. Columns get New thread, and Done gets show archived and archive all. Every item has a key that picks it while the menu is open (`D` Done, `1` `/weft:done`, `Y` YOLO). Fork isn't in it yet.
- ~~`Done` **Card library**~~ Replaced by star + tags (2026-10-12). Its recipes, to-dos and notes became starred cards tagged `recipe`, `to-do` or `note`; the files stay on disk.
- `Done` **Star and tags** — ☆ on every card and thread header (card menu `K`) stars a card, which is never auto-archived, and the rail's ★ shows only starred ones. Tags follow GitHub label rules (lowercase, ≤50 chars, ≤8 per card): up to two pills on the card's stage line, a tags dialog (`G`), and the 🏷 drawer (⌘L) like GitHub's labels page, with a colour catalog in `~/.weft/tags.json`. The retitle Haiku call also tags untagged cards from the board's own vocabulary, and the copilot has `set_tags` (docs/architecture/tags.md).
- ~~`P2` **Library page snapshots**~~ Dropped with the library.
- ~~`P2` **Fill recipe blanks in the pane**~~ Dropped with the library.
- `P2` **Swimlanes by project** — optional rows per project folder, so a board spanning several repos stays readable.
- ~~`P2` **Labels**~~ Shipped as tags: colored, filter the board from a pill or the 🏷 drawer.
- `P2` **Priority** — a priority field that sorts Backlog and that the run queue respects.
- `P2` **Saved views** — named filter and sort combinations, such as "this repo, Needs you first".
- `P2` **Bulk actions** — select several cards to start, stop, move, or archive them together.
- `P2` **Dependencies** — "start this card when that one reaches Review or Done", for work that has to happen in order.
- `P2` **Card density toggle** — compact cards (title and status only) for big boards, detailed cards for small ones.
- `P2` **Column counts and limits** — show counts per column and warn when Running goes over a set number.
- `P3` **Multiple boards** — separate boards (work, side projects) you switch between in the app, instead of restarting with another `THREADBOARD_DATA`.
- `P3` **Custom columns** — add columns like "Blocked" or "QA" and map BOARD STATUS values onto them.
- `P3` **Timeline view** — a lane per card showing when it ran and when it waited on you, to see parallelism and dead time.

## Cards and threads

- `Now` **Auto-retitle cards** — after a turn, a card named "Image attachment", "Untitled thread" or just its prompt's first line gets a Haiku title with an emoji (`lib/retitle.ts`, hooked in `lib/glance.ts`); `titleBy` marks a card named by you or by Weft so neither it nor Claude Code's sync renames it again. Still open: retitling when the thread's topic drifts, and a "rename with AI" card menu item.
- `Now` **Summary-first cards with a picture** — the card leads with the thread's last line in plain text, a 52 px thumbnail of its latest picture (thread screenshots and images, or a pane capture after each turn; hover to enlarge), an 8-dot stage bar with what's left, and a one-line footer. No picture yet: a Haiku emoji tile, or the folder's initial. Still open: emoji for cards that haven't had a turn since, and a setting to hide thumbnails.

- `Now` **Managed thread prompt and BOARD STATUS** — every board thread gets a system prompt asking it to end replies with a `BOARD STATUS` line; the board uses it to move the card to Needs you, Review, or Done and to show its stage and what's left. The parser skips status lines quoted in code blocks and reads the bold-label form (`**BOARD STATUS:** ...`).
- `Now` **Markdown rendering** — messages render as Markdown (headings, lists, tables, code blocks with a Copy button) in the same style as the composer. Still open: syntax highlighting.
- `Now` **Send later** — the reply box's clock (Alt+Enter) schedules a message for a set time, by default a minute after the plan's next 5-hour reset, or the weekly reset when the weekly limit is used up (offered from 90%); the server sends it even with the thread closed. Still open: scheduling from the copilot.
- `Now` **Suggested next message** — the Agent SDK's prompt suggestions (`promptSuggestions`) land on the card after each turn; the reply box shows the suggestion as its placeholder and Tab fills it in without sending. Claude threads only (not puku-cli or the copilot). Still open: a suggestion on the card itself, and one after a session's first turn (the CLI holds it back).
- `P1` **Queue a reply while running** — the reply box is disabled while a turn runs ("Working. Stop it to reply."); let you queue the next message instead.
- `P1` **Import existing CLI sessions** — list sessions from the CLIs' project folders and turn any of them into a card that resumes it.
- `Now` **Images in prompts and replies** — paste or drop images and videos into the new-thread dialog and reply box, inline where they go; images reach the agent as image blocks, videos as file paths.
- `Now` **Composer** — the new-thread dialog and reply box share a Markdown editor (formatting bar, ⌘B/⌘I, raw Markdown view), local dictation with whisper.cpp, and saved drafts.
- `Now` **Repo picker** — the new-thread folder field lists recent projects, git repos on this Mac with their branch, and GitHub repos through `gh`, cloning one into `~/dev` when picked.
- `P2` **Dictation hotkey and live text** — a shortcut to start the mic, and words appearing while you talk instead of after.
- `P1` **Fork a thread** — start a new card from a thread's current session, to try a second approach without losing the first.
- `P1` **Card templates** — saved prompts with folder, CLI, and permission mode ("fix lint", "add tests for X", "review my diff"), picked from the new-card dialog.
- `P1` **Full tool output** — tool results are clipped to 4,000 characters and summaries to 100; add "show full output" that reads the CLI's own transcript.
- `Now` **Collapsible tool runs** — a run of tool calls folds into one line ("Ran 3 commands, read 2 files +1") that opens to each call; screenshots stay visible under it.
- `Now` **Images in threads** — tool screenshots, images pasted into Claude Code sessions and local images an agent shows with `![](path)` appear inline, saved in `~/.weft/attachments`; click for full size.
- `Now` **Live sessions move columns** — a session busy in another app moves to Running, one waiting on a question to Needs you, read from Claude Code's own session list every 5 seconds.
- `P2` **Subagent drill-down** — subagent turns are hidden today; show them nested under the Task call that started them.
- `Done` **Continue and retry from the card** — a ▶ in the footer of any idle card with a session sends "continue" (for a model that gave up too early); a stopped or failed card also gets **Restart**, its last message again in a fresh CLI (`lib/card-resume.ts`, `lib/restart.ts`). **▶ Resume N** in the Review header carries on every turn there that a restart cut off or that failed (`lib/resume-actions.ts`).
- `Now` **Edit your last message** — ↑ in an empty reply box brings it back; Enter stops a running turn, rewinds the conversation to before the message (`resumeSessionAt`), folds the old turn into an "Edited" line, and sends the new text. Files stay as the turn left them. Claude board threads only; others send the edit as a new message. Still open: editing an older message, and undoing that turn's file edits (`rewindFiles`).
- `P2` **Auto-title** — name a card from its first exchange when you left the title blank, instead of the first 60 characters of the prompt.
- `P2` **Slash commands and skills in the reply box** — list the CLI's slash commands and skills available in the card's folder.
- `P2` **File mentions** — `@` autocompletes file paths from the card's folder in prompts and replies.
- `P2` **Context meter and compact** — show how full the thread's context is and offer `/compact` before it runs out mid-task.
- `P2` **Turn timings** — duration per turn and per tool call, so you can see where a slow turn spent its time.
- `P2` **Thread outline** — a jump list of your messages and turn results in the thread panel.
- `P2` **Private card notes** — a note field for you that the agent never sees.
- `P2` **Export a thread** — save a thread as Markdown to paste into a PR, issue, or doc.
- `P3` **Scheduled cards** — start a Backlog card at a set time or on a schedule (nightly dependency bump, weekly audit).
- `P3` **Re-run and compare** — run the same prompt again later and compare the result with the last run.

## Git, worktrees and code review

- `Not planned` **Worktree per card** — a worktree costs a fresh checkout, `npm install` and env setup per card, and leaves stray folders; Weft warns about busy folders and overlapping files instead (SOUL.md).
- `P1` **Branch per card** — a branch named from the card title (`tb/fix-login-redirect`), shown on the card.
- `P1` **Diff view in Review** — the files and hunks a card changed since it started, in the thread panel.
- `P1` **Commit, push, and open a PR** — buttons that commit the card's work, push its branch, and open a PR with `gh`; the PR link is saved on the card.
- `Done` **Busy-folder warning** — a card shows an amber "+N here" on its folder line while another card is busy in the same folder, and the reply box says "Also running here: …" (`lib/overlap.ts`). It doesn't look at uncommitted changes.
- `Done` **File overlap warning** — each card keeps the files its thread edited (Edit, Write, MultiEdit, NotebookEdit; `card.touchedFiles`, last 50), and when busy cards in one folder edited the same files the warning says so: "Also running here: Fix login — both edited a.ts" (`lib/overlap.ts`). It counts edits for the card's whole life, committed or not.
- `P2` **Worktree setup command** — a per-project command run in each fresh worktree (`npm install`, copy `.env.local`) before the thread starts.
- `P2` **Comment on the diff** — comments on diff lines go back to the thread as a reply, like a code review.
- `P2` **Merge and clean up** — when a card reaches Done, offer to merge its branch and remove its worktree.
- `P2` **Rebase button** — when the base branch moves, ask the thread to rebase and resolve conflicts.
- `P1` **Overlap warning** — flag when two running cards are editing the same files; tool items don't store file paths yet, so that comes first.
- `P2` **Rewind a turn** — use the SDK's file checkpoints to roll a card's files back to before a turn.
- `P2` **CI status on the card** — after a push, show GitHub checks; a failed check can send the card back to Needs you with the log attached.
- `P3` **Reviewer card** — spawn a second thread (another model or CLI) to review a card's diff and attach its findings to the original card.
- `P3` **Stacked cards** — chain cards so each branch builds on the previous one's.

## Agents, models and CLIs

- `Now` **CLI auto-login pop-up** — when Claude Code or puku-cli is logged out, run its login, show the output and login link in a pop-up, then let the card continue.
- `P1` **Model and effort per card** — pick the model and thinking effort when creating a card, and change them mid-thread.
- `P1` **Finish puku-cli support** — run a full puku thread end to end, fix any SDK differences, and add it to the smoke test (it has only connected so far).
- `P1` **Login shell environment** — read PATH and env from the user's login shell at startup, so an app opened from the Dock finds `puku-cli`, `node`, `gh`, and project tools.
- `P2` **Per-project defaults** — default CLI, model, permission mode, and extra instructions per project folder.
- `P2` **Plan-first cards** — start a card in plan mode; its plan lands in Review with an "Approve and run" button.
- `P2` **Rate-limit handling** — recognize usage-limit errors, park the card with a "retry at" time, and resume it automatically.
- `P2` **MCP servers per card** — see which MCP servers a card loads and turn some off, to cut startup time and tool noise.
- `P2` **Role presets** — reviewer, tester, docs writer: short instruction add-ons you can pick per card.
- `P2` **Environment per card** — extra env vars per card or project (feature flags, test database URL).
- `P2` **Switch CLI mid-card** — hand a thread's summary to the other CLI when one is rate-limited or logged out.
- `P3` **Other CLI adapters** — a backend interface so CLIs outside the Agent SDK (Codex, Gemini CLI) can be cards with the same thread view.
- `P3` **Cheap model for chores** — use a small model for titles, summaries, and digests instead of a full CLI thread.

## Copilot and orchestration

- `Done` **Threads can hand off work** — every board thread has `mcp__board__list_cards` (read-only) and `mcp__board__create_card` (starts in its own folder by default, records `parentId`); no move, stop, archive or read of other cards.
- `P3` **Show spawned cards** — use `parentId` to show which card started another on the board.
- `Done` **Copilot event feed** — with each of your messages the copilot gets a digest of cards that finished, need you, or failed since your last one (`lib/copilot-digest.ts`); no extra turns run.
- `Done` **Copilot on the board** — the copilot shows as a card (✨ whole board) at the top of its column; click opens it in the card window like any thread, Allow/Deny/Stop work on the card, a search hides it.
- `P2` **Copilot acts on its own** — start a copilot turn when a card finishes or needs you, instead of waiting for your next message.
- `P1` **Away digest** — "what happened while I was away": a short per-card summary of results since you last looked.
- `P2` **Spec to cards** — paste a spec; the copilot proposes a set of cards with folders and order, and creates them after you approve.
- `P2` **Review triage** — the copilot reads finished threads and suggests Done, a follow-up reply, or a reviewer card.
- `P2` **Batch approvals** — approve "start these five cards" once instead of five separate prompts.
- `P2` **Reply drafts** — the copilot drafts the next message in a card's reply box for you to edit and send.
- `P2` **More board tools** — give the copilot tools for archive, labels, priority, fork, diff, and templates as those features land.
- `P2` **Copilot standing rules** — rules like "allow `npm test` on threadboard cards" that the copilot applies, listed and editable in settings.
- `P2` **Copilot memory** — keep your stated preferences across "New chat" resets.
- `P2` **Docked copilot** — an option to show the copilot as a side panel in the main window instead of a separate window.
- `P3` **Loop watcher** — the copilot notices a card repeating the same failing command and stops it with a note.
- `P3` **Voice input** — dictate to the copilot.

## Browser pane

- `Now` **Always show something** — a working page in a card's blank pane when a turn starts (the card's own hovercar scene, dimmed, with the title, ask and a running clock), and a Haiku-written update page (how it's going, what we did, what's next) after any turn that showed nothing (`lib/glance.ts`). Measured 2026-10-10: Haiku with a bare CLI ~8-15s and steady; puku-ai-2.8 similar but 8-31s; Haiku via plain `claude -p` 18-45s from startup.
- `Now` **Card pages survive a restart** — each card's last page is saved to `~/.weft/pages/` (temp pages copied) and comes back when you open the card (`electron/pane-pages.cjs`).
- `P2` **Page history and cloud sync** — every page a card showed as a timeline, synced to Supabase (Postgres `card_pages` + Storage, R2 later if egress costs), with share links.
- `Now` **Page zoom** — a % button in the pane's toolbar (steps, presets, Actual Size), ⌘+/−/0 and ⌘+scroll on the page in Chrome's steps, and pinch to magnify (`electron/browser-pane.cjs`).
- `P2` **Fit to pane** — one click to fit a large image or a fixed-width page to the pane's width.
- `P2` **Glance switch and model** — a Settings toggle for the update page, and a choice of model.
- `P1` **Browser tab per card** — each card drives its own tab, and the pane shows the selected card's tab; today one page is shared by all cards.
- `P1` **Console and network tools** — let agents read console errors and failed requests from the pane, which is most of what debugging a dev server needs.
- `P1` **More input tools** — scroll, press a key, hover, select an option, and wait for an element, alongside `click` and `type_text`.
- `P2` **Structured page snapshot** — an accessibility-tree snapshot with element refs, so clicks don't depend on guessing CSS selectors.
- `P2` **Who's driving** — show when an agent is controlling the pane, and pause agent actions while you type in it.
- `P2` **Pick an element** — click something in the pane to send its selector and a screenshot to a card's reply box.
- `P2` **Dev server per card** — start a card's dev server in its worktree on a free port and open it in that card's tab.
- `P2` **Viewport sizes** — phone and tablet sizes for the pane, also available to agents as a tool.
- `P2` **Cookie profiles per project** — separate browser storage per project instead of one shared `persist:threadboard-browser` profile.
- `P2` **Navigation allowlist** — limit agent navigation to localhost and listed domains per project.
- `P3` **Pop-out pane** — move the browser into its own window, for a second monitor.
- `P3` **Session recording** — record what an agent did in the pane and attach it to the card for review.

## Permissions, safety and sandboxing

- `Done` **Default permission mode** — set in Settings (Auto out of the box); the new-thread dialog, the API, the copilot's `create_card` and warm spares all start in it.
- `Done` **Switch a card's permission mode** — from the thread header or the card menu, applied to the running CLI; picked-up Claude Code sessions keep the mode they last ran in.
- `P1` **Always-allow rules** — "allow always for this card / this project" on a prompt, saved as tool-plus-pattern rules you can edit in settings.
- `P1` **Full request detail** — expand a pending request on the card to see the whole command, the file diff for an edit, or the full URL before answering.
- `P1` **Deny with a reason** — deny and tell the agent what to do instead, rather than the fixed "The user denied this in Weft."
- `P2` **Permission inbox** — one list of every pending request across cards, answerable from the keyboard.
- `P2` **Queued requests on the card** — parallel tool calls queue up; show how many are waiting and allow answering them together.
- `P2` **Danger highlighting** — mark `rm -rf`, force pushes, writes outside the project folder, and installs from unknown sources in the prompt.
- `P2` **Folder boundary** — prompt or block when a card edits files outside its folder or worktree.
- `P2` **Sandboxed cards** — run a card under the CLI's sandbox or in a container, and require it for auto permission mode.
- `Done` **Secrets vault (local)** — 🔐 on the rail: a vault per repo, encrypted in Electron main, `.env` import with a preview, a nudge for `.env.local`, Touch ID to reveal or copy.
- `Done` **Vault: every project, by hand** — the drawer holds every board project's vault behind a project filter that follows the top bar (overridable); Add and Change Value… type secrets in without a `.env` file; Copy to <project> copies one between vaults in main.
- `Done` **Vault: add a secret by key** — Shift+`S` (also in the ⌘K palette and the `?` sheet) opens the 🔐 drawer on its Add form.
- `Done` **Vault: threads fill fields** — `mcp__secrets__list` (names only) and `mcp__secrets__fill_field` (Touch ID per card and site, then main types the value into the pane, masked, read back as `‹NAME›`).
- `Done` **Vault: values for commands** — `mcp__secrets__run`: approve the exact command and names (once or always), main runs it with no shell and the values in its env, output redacted to `‹NAME›`; dev servers get development values; a secrets-using card's stored tool results are redacted.
- `P1` **Vault: values for API calls and requests** — a header or body value for an HTTP request a thread makes (Supabase Management API), and `mcp__secrets__request` (Needs you with a paste field).
- `P2` **Vault: remembered approvals in the drawer** — list and remove the commands set to Always allow; patterns like `npm run job:*`.
- `Done` **Vault: `.env.local` written back** — Weft writes the file from the vault with a `# Managed by Weft` header and watches it for hand edits.
- `Done` **Account token behind safeStorage** — the Supabase session lives in `~/.weft/account.sealed`, sealed by Electron main; the server reads it through main.
- `P2` **Secret masking** — hide tokens and `.env` values in thread views, tool output, and exports.
- `P2` **Audit log** — an append-only record of every allowed and denied tool call: card, time, and whether you or the copilot answered.
- `P2` **Per-launch API token** — require a token on `/api` in addition to the host and header checks, since any local process can call it today.
- `P3` **Permission timeout** — auto-deny a request after a set time and notify you, so a forgotten prompt doesn't hold a CLI open indefinitely.

## Speed and reliability

- `Now` **Warm, pre-started CLIs** — keep a spare CLI loaded per project so a new card's first turn skips the 12–50 s wait for MCP servers, plugins, and hooks.
- `Now` **Error boundaries** — each card, the thread, the browser pane, the rail, the terminal and the footer sit in their own boundary (`components/CrashGuard.tsx`), and so do smaller pieces: every dialog's body (its header and ✕ stay), each rail drawer, each header badge, the Copilot and account buttons, the project bar, the New thread dialog, and inside a thread each message and tool run, the reply in progress, the permission request, the review panel and the reply box (small spots get an inline chip with the error on hover); Board's pieces, the header badges, the reply box and the review panel load through `guarded()` (`components/guarded.tsx`), so a module that throws while loading is caught in its spot too, and `app/error.tsx` hides the browser pane so its message shows, with `app/error.tsx` and `app/global-error.tsx` behind them, so a thread's half-written edit breaks one piece, not the whole board. A build error, which no boundary can catch, swaps Next's overlay for a small bar over the last version that built (`components/BuildErrorBar.tsx`). At startup a failed load or a crashed renderer shows the start screen's error with Retry (`electron/startup-screen.cjs`).
- `Done` **Import guard** — a build error is past any boundary (nothing compiles), so a PostToolUse hook on every thread (`lib/import-check.ts`, in `guardedCli()`) reports imports an edit just broke: an export removed that another file still imports, or a name or module that isn't there. ~20ms per edit, text matching, no type-checker. Came from a star+tag card whose parallel subagents removed `starMenu` while the board still imported it.
- `Done` **Restart guard** — every restart of Weft's server cut off every running card (10 launches and ~30 dropped cards in four days, some from threads running `kill -9` on the server). A PreToolUse hook (`lib/restart-guard.ts`, in `guardedCli()`) denies Bash that would kill Weft's server, app or port, or start a second Weft in its folder, while other turns run, and tells the thread how many it would cut off and to ask you; the thread prompt says the same. A CLI that keeps working after its turn ended now shows Running, so the restart recovery catches it. Next: let the user OK a restart from the board, and restart once those turns finish.
- `Now` **Startup timer** — each launch's phases are saved to `~/.weft/startup.jsonl` (`electron/startup-timer.cjs`), and a launch well over the usual time shows a toast naming the slowest phase (`lib/use-startup-check.ts`). On 2026-10-11 two changes came out of it: the login-shell PATH (~1s of `zsh -ilc`) is now saved and refreshed in the background, and `.next` is kept between launches, along with Turbopack's cache, unless a stale server had to be killed.
- `P1` **Crash-safe storage** — write `board.json` and thread files to a temp file and rename, and keep a rolling backup, so a crash mid-write can't lose the board.
- `P1` **Concurrency cap and run queue** — limit how many cards run at once; extra starts wait and begin in priority order.
- `Done` **Resume after restart** — a card that was running (or waiting on a permission) when the app closed carries on by itself after the restart: `lib/store.ts` marks it `interrupted` on load and `lib/resume.ts` sends its session a "Weft restarted, pick up where you left off" turn. Up to three carry-ons in a row (`resumes`), so a turn that keeps getting cut off stops for Resume all.
- `P2` **Append-only thread files** — threads are rewritten in full on every new item; switch to append-only JSONL so long threads stay cheap.
- `P2` **Paged thread loading** — load the last N items when opening a card and fetch older ones on scroll.
- `P2` **Event replay on reconnect** — number SSE events and replay missed ones, instead of reloading the whole board after every reconnect.
- `P2` **Process monitor** — show each open CLI's memory and CPU, close idle ones, and cap the total number of warm processes.
- `P2` **Stuck-turn detection** — flag a card that has produced nothing for N minutes and offer stop or retry.
- `P2` **Per-card logs** — keep each thread's CLI stderr in a log you can open from the card, not only in the app's console.
- `P2` **Diagnostics panel** — CLI paths and versions, login state, MCP startup times, port, and data folder size in one place.
- `P3` **Board file versioning** — a schema version in `board.json` with migrations, so updates never break a saved board.

## Notifications and presence

- `Now` **Desktop notifications** — a native notification when a card needs you, finishes, or fails; clicking it opens the card.
- `P1` **Dock badge** — the Needs you count on the Dock icon, so you can tell at a glance whether anything is waiting.
- `P2` **Menu bar list** — a menu bar icon listing cards that need you, with Allow and Deny right there.
- `Done` **Keep Working** — the menu bar icon's switch for staying awake with the lid shut (`pmset disablesleep` behind a one-time sudoers rule). It runs until threads finish or for 1/2/3/8 hours, and a watchdog puts sleep back at the deadline, at 10% battery, or if Weft dies (`electron/keep-working.cjs`).
- `P2` **Unread dots** — a dot on cards with new output you haven't opened.
- `P2` **Notification rules** — choose per project which events notify you, plus quiet hours.
- `P2` **Answer from the notification** — Allow and Deny buttons on the notification itself.
- `Now` **Sounds** — a chime when a card moves to Running, Needs you, Review, or Done, or hits an error; moves you make stay quiet, and Settings has on/off, volume, and a toggle and preview per chime. The sounds are CC0 vibraphone samples in `public/sounds/`.
- `Now` **Unseen highlight** — a card that moves to Needs you, Review, or Done without you (the same moves that chime) gets an accent tint and a pulsing dot until you open it.
- `P3` **Batched notifications** — hold notifications during focus time and deliver them every N minutes.

## Remote and mobile access

- `P2` **Phone view** — a mobile board over a private tunnel (Tailscale or a paired relay) to answer permissions and reply away from the desk.
- `P2` **Phone push** — push "needs you" to your phone (ntfy, Pushover, or a native app).
- `P2` **Device pairing** — pair a phone with a QR code and a device token, since the API only accepts localhost today.
- `P3` **Chat bridge** — answer permissions and send replies through a messaging app.
- `P3` **Headless server mode** — run the board without Electron on an always-on machine and open it from any browser.
- `P3` **Remote runners** — run a card's CLI on another machine or a cloud VM while the board stays on your laptop.

## Collaboration

- `P2` **Project config file** — a `.weft.json` in a repo with default CLI, setup command, templates, and allow rules, shared by everyone who clones it.
- `P3` **Hand off a card** — export a card and its session so a teammate can resume it on their machine.
- `P3` **Shared board** — sync one board between people; each card shows whose machine is running it.
- `P3` **Card comments** — notes from teammates on a card that the agent doesn't see.
- `P3` **Read-only thread link** — share a snapshot of a thread as a page for someone to review.

## Cost and analytics

- `Not planned` **Cost totals** — Weft runs on a Claude subscription, so dollar estimates are hidden everywhere (cards, threads, copilot, recipe pages); cost is still recorded per card.
- `Done` **Prompt cache warmth** — the status strip's `cache:52m` counts down how long the thread's prompt cache stays warm after its last request (1 hour or 5 minutes, read from what the request wrote), then turns to `cache:cold 120k`: the next message sends that many tokens again at full price, a bigger bite of the 5-hour limit. Its tooltip gives the last request's cache hit share (`lib/turn.ts` `cacheAfter`, `CardStats.cache`). Next: warn in the reply box before you send to a long, cold thread.
- `P2` **Budgets** — a spend cap per card or per day; the card pauses and asks when it reaches it.
- `P2` **Token usage per turn** — input, output, and cache tokens from each turn's result, to spot threads that reread too much.
- `P2` **Plan usage** — for Claude subscriptions, show remaining session and weekly usage so you know when a limit is coming.
- `P2` **Flow stats** — cards finished per day, time spent in each column, and total time cards waited on you.
- `P3` **Spend by CLI and model** — compare Claude and puku cost for similar kinds of tasks.
- `P3` **CSV export** — card history with cost, turns, and durations.

## Progress and gamification

- `Done` **Streaks, XP, badges and the builder card** — the header's 🔥 chip and "Your loom" dialog: XP that pays shipping (and healthy code) over volume, streaks with freezes, 38 badges, eight attributes and a class, stack skills, the activity cloth, personal records (`lib/game*.ts`, `lib/activity.ts`, docs/architecture/gamification.md).
- `Done` **Production-ready tree** — per-project testing, security, observability, docs and delivery checks read from the repo, each with "Set it up" to start a card (`lib/project-checks.ts`, `lib/project-badges.ts`).
- `P1` **Leagues** — weekly leagues of ~30 by XP, top 7 up and bottom 5 down, once accounts land; sync only weekly XP and a display name. The log's stable event ids are there for it.
- `P2` **Daily quests** — three small goals a day ("Ship 3 cards", "Clear Needs you") with bonus XP.
- `P2` **Weekly recap** — on Monday the browser pane opens "Your week in Weft": shipped, projects, streak, new badges.
- `P2` **What you build** — Haiku tags each shipped card with a domain (Payments, AI agents, Decks) for the builder card.
- `P2` **Audit clean** — an `npm audit` check (no high or critical) in the Security branch, run at most daily.
- `P3` **Public builder card** — your profile beside your name in a league, shareable as an image; find collaborators by class and stack.
- `P3` **Weft Wrapped** — a year-in-review page and image.
- `P3` **Efficiency and test-first badges** — ship under $1, a 95% cache hit week; a card that edited the test before the code.

## Search and memory

- `P1` **Search** — ⌘K search across card titles, prompts, agent replies, and tool commands.
- `P2` **Command palette** — the same ⌘K box runs actions: new card, switch project, toggle browser, open settings.
- `P2` **Done summaries** — a one-paragraph summary saved when a card reaches Done, used by search and digests.
- `P2` **Project memory** — per-project notes added to every card's instructions in that folder, or a quick editor for the repo's `CLAUDE.md`.
- `P2` **Related cards** — while writing a new card, show past cards in the same folder with similar prompts.
- `P3` **Semantic search** — find "where did we fix the SSE reconnect" by meaning, not exact words.
- `P3` **Lessons capture** — on Done, ask the thread for lessons worth keeping and add them to project memory after you approve.

## Integrations

- `Now` **Email at weft.zip** — Resend receives every mail to the domain and the deployed Weft forwards it to one inbox (`lib/email-forward.ts`, docs/architecture/email-forwarding.md). Still open: a DMARC record, per-alias routing, attachments over Resend's 40 MB.
- `Now` **GitHub Issues sync** — in phases (docs/architecture/github-issues.md):
  - `P1` Phase 1, card → issue: make an issue from a card, its tags as labels, and link the two.
  - `Done` Phase 2, issues → cards: ⌘K "Import GitHub issues into <project>" opts a folder in; its open issues become Backlog cards through `gh` (body + link + "Fixes owner/name#N" as the prompt, labels as tags), re-checked every 5 min. A closed issue archives its card if it never started; started cards are never touched; a deleted card stays deleted (`lib/github-issues.ts`).
  - `Done` Instant sync by webhook: a repo webhook posts to `/api/github/webhook` on the deployed Weft (Vercel), which saves a `github_events` row the server hears through Realtime and syncs that repo (`lib/github-hooks.ts`). The poll stays as the fallback.
  - `Done` The GitHub drawer on the left rail: the `gh` sign-in, and per project its repo, the issue sync switch, the last sync, Sync now (`components/GithubDrawer.tsx`, `lib/github-status.ts`).
  - `P2` Phase 3, two-way: title, labels and open/closed kept in step both ways.
  - `P2` Phase 4, Projects v2: a GitHub Project's Status column follows the card's column.
  - `P2` Phase 5, comments: a turn's summary posted to the issue (summaries only, vault values removed, a warning on a public repo).
- `P2` **PR review comments back to the card** — new review comments on a card's PR show up as a reply draft on that card.
- `P2` **Open in editor** — open a card's folder or worktree in VS Code, Cursor, or Zed, and jump to a file and line from a tool row.
- ~~`P2` **Open in terminal** — open a terminal in the card's folder or worktree.~~ Shipped as the terminal drawer (Control-backtick as in VS Code, or `t`): a shell per folder that follows the open card or selected project, split side by side up to three (⌘\\).
- `P2` **Packaged terminal** — bundle `node-pty` into the packaged app, and a way to close idle folders' shells.
- `P2` **Board CLI** — `weft add "fix the flaky test" --cwd .` to create cards from a terminal or script.
- `P2` **Linear** — create cards from Linear issues and keep issue status in step with the card's column.
- `P2` **Slack** — post Done and Needs-you summaries to a channel, and create cards from a slash command.
- ~~`P2` **BlastCP queue on the rail**~~ Shipped as the BlastCP rocket on the rail: connect with OAuth, link a property per project, see its next posts, drafts and failures, open them in the pane. Next: draft a post from a card, and a rail badge for posts waiting on you.
- ~~`P2` **Link a Vercel project**~~ Shipped as ▲ on the rail: token in the Keychain, link an existing project or make a new one (with its GitHub repo connected), see the latest deploy. Next, in the same drawer: connect GitHub on an already-linked project, deploy and redeploy, and build and runtime logs. Built: push 🔐 vault values to Vercel environments, from the drawer or a thread (`mcp__secrets__push_to_vercel`), Touch ID per push.
- ~~`P2` **Link a Supabase project**~~ Shipped as the bolt on the rail: token in the Keychain, link a project (or pick up `.mcp.json`'s), see its state, region, unapplied migrations, Restore a paused one. Next: push migrations from the drawer, copy the URL and keys into the 🔐 vault, add the Supabase MCP server for threads, create a project in place.
- `P2` **Vercel previews** — after a push, open the preview deployment in the card's browser tab and save the URL on the card.
- `P3` **Sentry** — create a card from an error with its stack trace and a link back.
- `P3` **Jira and GitLab** — the same issue and PR flows for teams on those tools.
- `P3` **Incoming webhook** — a token-protected local endpoint that creates cards from scripts, such as a CI failure.

## Settings and onboarding

- `Now` **Settings dialog** — one place to edit the thread prompt, how long idle CLIs stay open, recent projects, and CLI login state.
- `Now` **Weft account** — optional sign-in: a GitHub "Sign in" button in the top bar right of Copilot (your avatar once signed in, `components/AccountButton.tsx`), and Settings → Weft account with GitHub, Google or an email link, against the Weft prod Supabase project (`lib/account.ts`, `components/AccountSettings.tsx`). PKCE in the system browser, back to Weft on `weft://account-callback` (the loopback `/api/account/callback` in plain `next dev`); the session lives in `~/.weft/account.json` (0600). First real GitHub sign-in verified 2026-10-12: one user, one profile row. A `profiles` table with row-level security is filled on first sign-in (`supabase/migrations/`). Nothing uses the account yet: it's the base for page sync, share links and shared boards.
- `P1` **First-run check** — on first launch, check for `claude` and `puku-cli`, their login state, and `git`, then pick a first project folder.
- `P2` **Guided first card** — a starter card in a scratch folder that shows Running, Needs you, Review, and the browser pane in a couple of minutes.
- `P2` **Data folder in settings** — choose where the board is stored from settings instead of the `THREADBOARD_DATA` variable.
- `Now` **Shortcuts sheet** — `?` lists every keyboard shortcut (board, composer, terminal, app menu), searchable by words or keys; hold ⌘ or ⇧ for a cheat card; tooltips, the filter box and right-click menus show keys.
- `P2` **Export and import settings** — move the thread prompt, templates, and rules to another machine as one file.
- `Now` **Theme** — light, dark, or follow the system, from Settings → Appearance; the desktop window chrome follows it too.
- `Now` **Scene themes** — Twin Suns, Canyon, Coast Road, Neon City, Snow Pass and Salt Flats: Weft's own pictures behind the board, each with a palette drawn from it and clear columns (Settings → Appearance, or ⌘K "Theme: …").

## Packaging, updates and distribution

- `P1` **Packaged macOS app** — a build pipeline that bundles the built Next output with Electron, so the app doesn't need the repo or `npm run desktop`.
- `P1` **Signing and notarization** — sign and notarize the macOS build so it opens without Gatekeeper warnings. Wired up in `.github/workflows/release.yml` (Developer ID, hardened runtime, notarytool via an App Store Connect key); waiting on the certificate from Alex's individual Apple Developer membership.
- `Done` **Auto-update** — a packaged Weft checks the latest GitHub release's `update.json` at launch and every 4 hours; a signed build downloads in the background and offers Restart to Update, an unsigned one offers the download (`electron/updater.cjs`, docs/architecture/updates.md). Next: show the release notes after the restart.
- `Done` **Home page at weft.zip** — the deployed Weft (Vercel) renders a landing page at `/` instead of the board (`components/home/`, `lib/home.ts`; `/home` locally): one screen, on purpose: the emblem, the headline and one sentence over the twin suns scene, a real screenshot of the board (`public/brand/board.png`) and a download button that reads the latest release's `update.json` (`lib/home-release.ts`) and `app/opengraph-image.tsx` for shared links. Next: the weft.zip domain on the Vercel project; refresh the screenshot after big board changes.
- `Done` **Changelog and tagged releases** — `CHANGELOG.md` (Keep a Changelog); a `vX.Y.Z` tag builds and publishes the release with that version's section as its notes.
- `P2` **Single-instance lock** — stop a second copy of the app (or `npm run dev`) from using the same data folder at once.
- `P2` **Window state** — remember window size and position, the open card, and the browser pane's width and visibility across launches.
- `P2` **Windows and Linux builds** — handle paths, the `/usr/bin/which` lookup, and shell environment differences.
- `P3` **Homebrew cask** — `brew install --cask weft`.
- `P3` **Opt-in crash reports** — send crash logs only if the user turns it on.

## Testing and quality

- `P1` **Unit tests for the core** — *started: `npm test` (Vitest) covers BOARD STATUS parsing, review tours, the API guard, automations, format helpers, and every API route (`app/api/routes.test.ts`).* Still to do: store reload rules (running cards become Review on restart), and cost accounting across resumed sessions.
- `Done` **Runner tests** — `lib/runner.test.ts` drives the SDK loop against a fake `query()`: results, permissions and questions, stop, the turn queue, warm spares, login, and the CLI going away. No stub CLI executable yet.
- `Done` **Coverage per project** — the header's "49% coverage" follows the project in view, hovers a breakdown, and without a report is a **Set up coverage** button that starts a `/weft:setup-done` thread there.
- `Done` **A quality score that never maxes out** — the header's code quality badge earns 90 from the checklist (coverage, file size, lint lockdown, types, guardrails) and the last 10 from a **refactor scout**: a read-only Sonnet run that ranks concrete findings (file:line, Fowler smell, category, one-line fix, plus lint rules not yet on and loose types), cached per project with its commit, started once for a project with no report, then refreshed by `/weft:done` or **Re-scout now** (never just because HEAD moved). Each finding starts its own card from the badge's menu. Next: let the copilot hand out findings, and show which ones a card fixed.
- `Done` **Commit the uncommitted pile** — the header's "+N/-N" beside the quality badge (moved up from the status strip) counts the project's uncommitted lines; clicking it starts a card that maps `git status` onto the Review cards' `touchedFiles` (shared, busy and unclaimed files flagged) and commits card by card, by path, with a live checklist page (`lib/commit-pile.ts`, `app/api/pile`). Each change on the page has a review bar whose buttons answer the thread through `weft://reply` links, so you act on the page instead of typing in the thread. Its Commit buttons are `weft://commit` links that commit, push and move the card to Done with no LLM turn (`lib/pile-commit.ts`); the thread steps in only when a step fails. Next: let the copilot suggest it when Review piles up, and mark a card's files as committed so the overlap warning forgets them.
- `Done` **Plan the Backlog into sprints**: the header's ☰ N beside the uncommitted counter counts the repo's Backlog cards. Clicking it starts a read-only card that sizes each one, flags duplicates, cards already done, vague cards and oversized cards, and groups the rest into sprints of cards that touch different files, so each sprint runs side by side in one folder. A sprint plan page drives it through `weft://reply` buttons, and it starts a sprint's cards over `PATCH /api/cards/<id>` only on your OK (`lib/sprint-plan.ts`, `app/api/sprint`). Next: a one-click Start this sprint with no LLM turn, like the pile's `weft://commit`, and feed the plan's order into the run queue.
- `P1` **UI tests** — *started: behavior tests (jsdom + Testing Library, `components/*.test.tsx`) for the card (busy-folder "+N here", Allow/Deny, Stop), the reply box (send, queue while running, Send now, send later, busy-folder warning) and the new-thread dialog (Start vs backlog, folder, busy-folder hint).* Still to do: the board, the thread view, and the real TipTap composer (stubbed in these tests).
- `P2` **CI** — lint, typecheck, and tests on every push.
- `P2` **End-to-end tests** — drive the Electron app: create a card, start it, allow a request, reply, drag it to Done.
- `P2` **Status-line checks** — measure how often each model and CLI ends replies with a valid BOARD STATUS line, and catch regressions when the prompt changes.
- `P2` **Failure drills** — kill a CLI mid-turn, drop the event stream, and corrupt `board.json` on purpose to confirm the app recovers.
- `P3` **Large-board test** — 500 cards and threads with 10,000 items stay responsive.

## Accessibility and polish

- `P1` **Keyboard-first board** — arrow keys between cards, Enter to open, A and D to allow or deny, N for a new card.
- `Done` **Move without dragging** — the card's right-click menu and the command palette move cards between columns.
- `P2` **Screen reader announcements** — a live region that reads out card moves and new permission requests.
- `P2` **Focus return** — focus goes back to the card after closing its thread panel or a dialog.
- `P2` **Resizable thread panel** — drag the divider between the thread and its browser in the full-screen overlay, and remember the split.
- `P2` **Clear error messages** — plain explanations with a fix for common failures: CLI not on PATH, folder missing, logged out, port in use.
- `P2` **Contrast and motion** — check the column colors against contrast guidelines and respect reduced-motion settings.
- `P3` **Text size** — a setting for card and thread text size.
- `P3` **Localization** — keep UI strings in one place so the app can be translated.

## Proposed after the first test runs (2026-10-09)

Ideas that came out of building and testing the projects bar, board status, warm CLIs, login, and questions.

- `P1` **Needs-you inbox** — one keyboard-driven queue of every waiting question and permission request across cards (a to allow, d to deny, 1–4 to pick an answer), so clearing ten blocked cards takes seconds.
- `P1` **Answer from the notification** — Allow, Deny, and the options of a question as buttons on the macOS notification itself, so a blocked card can move without switching to the app.
- `P1` **Lean thread profile** — choose which MCP servers, plugins, and hooks load in board threads (per project), since they are most of a CLI's 4–50s start time and memory.
- `Now` **Stage automations** — rules that run a skill when a thread starts, you move a card to Review or Done, or a prompt you send matches a regex (once per thread per skill; Done runs `/weft:done` by default, which commits and, with **Push on Done** on (the default), pushes). Still to come: per-project rules, a "needs you for over 10 minutes" trigger, and non-skill actions like opening the diff or pinging Slack.
- `P1` **Dev server watcher** — notice when a thread starts a server or prints a localhost URL and offer to open it in the browser pane, tied to that card.
- `P2` **Board status health** — flag threads that stop writing the BOARD STATUS line (instructions ignored or overridden) and nudge them once, so cards don't sit in Review by default.
- `P2` **Copilot policies** — plain-English standing rules the copilot applies to permission requests ("allow read-only commands in deckcp, ask me about anything that pushes"), with a log of what it allowed.
- `P2` **Checkpoints and rewind** — snapshot a card's files and session before risky steps and roll both back with one click.
- `P2` **Menu bar presence** — a menu bar icon with the needs-you count and running cards, and a global shortcut that opens the copilot from any app.
- `P2` **Card from anywhere** — a share-sheet / Raycast / Alfred action that turns selected text or a URL into a Backlog card in the current project.
- `P2` **Standup to Slack** — the copilot posts a morning summary (finished, blocked, spent) to a Slack channel or DM.
- `P3` **Prompt library from history** — find prompts you've sent more than once across threads and offer them as templates.
