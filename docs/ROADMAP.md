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

- `Now` **Projects bar** — a bar above the columns listing the project folders in use, to filter the board to one or more projects and sort cards by activity, age, or cost.
- `P1` **Order within a column** — drag to reorder cards inside a column and keep that order, so the top of Backlog is what runs next.
- `P1` **Archive instead of delete** — Done cards move to a searchable archive after N days; today delete also removes the card's thread view for good.
- `P1` **Undo** — a short undo toast after a move, stop, or delete, since a misplaced drag or delete is easy to make and hard to fix.
- `P1` **Card actions menu** — a ⋯ menu on each card (move to, start, stop, fork, archive, open folder) so nothing depends on drag-and-drop.
- `P2` **Swimlanes by project** — optional rows per project folder, so a board spanning several repos stays readable.
- `P2` **Labels** — free-form colored tags (bug, refactor, spike) that the projects bar can filter on.
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

- `Now` **Managed thread prompt and BOARD STATUS** — every board thread gets a system prompt asking it to end replies with a `BOARD STATUS` line; the board uses it to move the card to Needs you, Review, or Done and to show its stage and what's left. The parser skips status lines quoted in code blocks and reads the bold-label form (`**BOARD STATUS:** ...`).
- `P1` **Markdown rendering** — render assistant messages as Markdown with syntax-highlighted code blocks and copy buttons.
- `P1` **Queue a reply while running** — the reply box is disabled while a turn runs ("Working. Stop it to reply."); let you queue the next message instead.
- `P1` **Import existing CLI sessions** — list sessions from the CLIs' project folders and turn any of them into a card that resumes it.
- `Now` **Images in prompts and replies** — paste or drop images and videos into the new-thread dialog and reply box, inline where they go; images reach the agent as image blocks, videos as file paths.
- `Now` **Composer** — the new-thread dialog and reply box share a Markdown editor (formatting bar, ⌘B/⌘I, raw Markdown view), local dictation with whisper.cpp, and saved drafts.
- `Now` **Repo picker** — the new-thread folder field lists recent projects, git repos on this Mac with their branch, and GitHub repos through `gh`, cloning one into `~/dev` when picked.
- `P2` **Dictation hotkey and live text** — a shortcut to start the mic, and words appearing while you talk instead of after.
- `P1` **Fork a thread** — start a new card from a thread's current session, to try a second approach without losing the first.
- `P1` **Card templates** — saved prompts with folder, CLI, and permission mode ("fix lint", "add tests for X", "review my diff"), picked from the new-card dialog.
- `P1` **Full tool output** — tool results are clipped to 4,000 characters and summaries to 100; add "show full output" that reads the CLI's own transcript.
- `P2` **Collapsible tool runs** — fold a run of consecutive tool calls into one row, so long threads are about the conversation, not the `grep`s.
- `P2` **Subagent drill-down** — subagent turns are hidden today; show them nested under the Task call that started them.
- `P2` **Retry after an error** — one click to resend the last message after "Ended early" or an API error.
- `P2` **Edit and resend** — edit your last message and rerun the turn from there.
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

- `P1` **Browser tab per card** — each card drives its own tab, and the pane shows the selected card's tab; today one page is shared by all cards.
- `P1` **Console and network tools** — let agents read console errors and failed requests from the pane, which is most of what debugging a dev server needs.
- `Now` **Always show something** — a starter page in a new card's pane, and a Haiku-written update page (how it's going, what we did, what's next) after any turn that showed nothing (`lib/glance.ts`). Measured 2026-10-10: Haiku with a bare CLI ~8-15s and steady; puku-ai-2.8 similar but 8-31s; Haiku via plain `claude -p` 18-45s from startup.
- `P2` **Glance switch and model** — a Settings toggle for the update page, and a choice of model.
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
- `P1` **Always-allow rules** — "allow always for this card / this project" on a prompt, saved as tool-plus-pattern rules you can edit in settings.
- `P1` **Full request detail** — expand a pending request on the card to see the whole command, the file diff for an edit, or the full URL before answering.
- `P1` **Deny with a reason** — deny and tell the agent what to do instead, rather than the fixed "The user denied this in Weft."
- `P2` **Permission inbox** — one list of every pending request across cards, answerable from the keyboard.
- `P2` **Queued requests on the card** — parallel tool calls queue up; show how many are waiting and allow answering them together.
- `P2` **Danger highlighting** — mark `rm -rf`, force pushes, writes outside the project folder, and installs from unknown sources in the prompt.
- `P2` **Folder boundary** — prompt or block when a card edits files outside its folder or worktree.
- `P2` **Sandboxed cards** — run a card under the CLI's sandbox or in a container, and require it for auto permission mode.
- `P2` **Secret masking** — hide tokens and `.env` values in thread views, tool output, and exports.
- `P2` **Audit log** — an append-only record of every allowed and denied tool call: card, time, and whether you or the copilot answered.
- `P2` **Per-launch API token** — require a token on `/api` in addition to the host and header checks, since any local process can call it today.
- `P3` **Permission timeout** — auto-deny a request after a set time and notify you, so a forgotten prompt doesn't hold a CLI open indefinitely.

## Speed and reliability

- `Now` **Warm, pre-started CLIs** — keep a spare CLI loaded per project so a new card's first turn skips the 12–50 s wait for MCP servers, plugins, and hooks.
- `P1` **Crash-safe storage** — write `board.json` and thread files to a temp file and rename, and keep a rolling backup, so a crash mid-write can't lose the board.
- `P1` **Concurrency cap and run queue** — limit how many cards run at once; extra starts wait and begin in priority order.
- `P1` **Resume after restart** — cards that were running come back as "Stopped when the app closed"; offer a one-click (or automatic) resume.
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

- `P1` **Cost totals** — spend per project, per day, and for the whole board in the header; today cost only appears per card.
- `P2` **Budgets** — a spend cap per card or per day; the card pauses and asks when it reaches it.
- `P2` **Token usage per turn** — input, output, and cache tokens from each turn's result, to spot threads that reread too much.
- `P2` **Plan usage** — for Claude subscriptions, show remaining session and weekly usage so you know when a limit is coming.
- `P2` **Flow stats** — cards finished per day, time spent in each column, and total time cards waited on you.
- `P3` **Spend by CLI and model** — compare Claude and puku cost for similar kinds of tasks.
- `P3` **CSV export** — card history with cost, turns, and durations.

## Search and memory

- `P1` **Search** — ⌘K search across card titles, prompts, agent replies, and tool commands.
- `P2` **Command palette** — the same ⌘K box runs actions: new card, switch project, toggle browser, open settings.
- `P2` **Done summaries** — a one-paragraph summary saved when a card reaches Done, used by search and digests.
- `P2` **Project memory** — per-project notes added to every card's instructions in that folder, or a quick editor for the repo's `CLAUDE.md`.
- `P2` **Related cards** — while writing a new card, show past cards in the same folder with similar prompts.
- `P3` **Semantic search** — find "where did we fix the SSE reconnect" by meaning, not exact words.
- `P3` **Lessons capture** — on Done, ask the thread for lessons worth keeping and add them to project memory after you approve.

## Integrations

- `P1` **GitHub issue to card** — create a card from an issue (body as prompt, link kept); comment on or close the issue when the card is done.
- `P2` **PR review comments back to the card** — new review comments on a card's PR show up as a reply draft on that card.
- `P2` **Open in editor** — open a card's folder or worktree in VS Code, Cursor, or Zed, and jump to a file and line from a tool row.
- ~~`P2` **Open in terminal** — open a terminal in the card's folder or worktree.~~ Shipped as the terminal drawer (Control-backtick as in VS Code, or `t`): a shell per folder that follows the open card or selected project, split side by side up to three (⌘\\).
- `P2` **Packaged terminal** — bundle `node-pty` into the packaged app, and a way to close idle folders' shells.
- `P2` **Board CLI** — `weft add "fix the flaky test" --cwd .` to create cards from a terminal or script.
- `P2` **Linear** — create cards from Linear issues and keep issue status in step with the card's column.
- `P2` **Slack** — post Done and Needs-you summaries to a channel, and create cards from a slash command.
- `P2` **Vercel previews** — after a push, open the preview deployment in the card's browser tab and save the URL on the card.
- `P3` **Sentry** — create a card from an error with its stack trace and a link back.
- `P3` **Jira and GitLab** — the same issue and PR flows for teams on those tools.
- `P3` **Incoming webhook** — a token-protected local endpoint that creates cards from scripts, such as a CI failure.

## Settings and onboarding

- `Now` **Settings dialog** — one place to edit the thread prompt, how long idle CLIs stay open, recent projects, and CLI login state.
- `P1` **First-run check** — on first launch, check for `claude` and `puku-cli`, their login state, and `git`, then pick a first project folder.
- `P2` **Guided first card** — a starter card in a scratch folder that shows Running, Needs you, Review, and the browser pane in a couple of minutes.
- `P2` **Data folder in settings** — choose where the board is stored from settings instead of the `THREADBOARD_DATA` variable.
- `P2` **Shortcuts sheet** — `?` lists every keyboard shortcut, including ⌘J and ⌘⇧B.
- `P2` **Export and import settings** — move the thread prompt, templates, and rules to another machine as one file.
- `Now` **Theme** — light, dark, or follow the system, from Settings → Appearance; the desktop window chrome follows it too.

## Packaging, updates and distribution

- `P1` **Packaged macOS app** — a build pipeline that bundles the built Next output with Electron, so the app doesn't need the repo or `npm run desktop`.
- `P1` **Signing and notarization** — sign and notarize the macOS build so it opens without Gatekeeper warnings.
- `P2` **Auto-update** — check for new releases, download in the background, and show release notes after restart.
- `P2` **Single-instance lock** — stop a second copy of the app (or `npm run dev`) from using the same data folder at once.
- `P2` **Window state** — remember window size and position, the open card, and the browser pane's width and visibility across launches.
- `P2` **Windows and Linux builds** — handle paths, the `/usr/bin/which` lookup, and shell environment differences.
- `P3` **Homebrew cask** — `brew install --cask weft`.
- `P3` **Opt-in crash reports** — send crash logs only if the user turns it on.

## Testing and quality

- `P1` **Unit tests for the core** — *started: `npm test` (Vitest) covers BOARD STATUS parsing, review tours, the API guard, automations, format helpers, and every API route (`app/api/routes.test.ts`).* Still to do: store reload rules (running cards become Review on restart), and cost accounting across resumed sessions.
- `Done` **Runner tests** — `lib/runner.test.ts` drives the SDK loop against a fake `query()`: results, permissions and questions, stop, the turn queue, warm spares, login, and the CLI going away. No stub CLI executable yet.
- `P1` **UI tests** — component tests for the board, thread view, and reply box; the UI has none today.
- `P2` **CI** — lint, typecheck, and tests on every push.
- `P2` **End-to-end tests** — drive the Electron app: create a card, start it, allow a request, reply, drag it to Done.
- `P2` **Status-line checks** — measure how often each model and CLI ends replies with a valid BOARD STATUS line, and catch regressions when the prompt changes.
- `P2` **Failure drills** — kill a CLI mid-turn, drop the event stream, and corrupt `board.json` on purpose to confirm the app recovers.
- `P3` **Large-board test** — 500 cards and threads with 10,000 items stay responsive.

## Accessibility and polish

- `P1` **Keyboard-first board** — arrow keys between cards, Enter to open, A and D to allow or deny, N for a new card.
- `P2` **Move without dragging** — a keyboard and menu way to move cards between columns, since drag-and-drop is the only way today.
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
- `Now` **Stage automations** — rules that run a skill when a thread starts, you move a card to Review or Done, or a prompt you send matches a regex (once per thread per skill; Done runs `/weft:done` by default). Still to come: per-project rules, a "needs you for over 10 minutes" trigger, and non-skill actions like opening the diff or pinging Slack.
- `P1` **Dev server watcher** — notice when a thread starts a server or prints a localhost URL and offer to open it in the browser pane, tied to that card.
- `P2` **Board status health** — flag threads that stop writing the BOARD STATUS line (instructions ignored or overridden) and nudge them once, so cards don't sit in Review by default.
- `P2` **Copilot policies** — plain-English standing rules the copilot applies to permission requests ("allow read-only commands in deckcp, ask me about anything that pushes"), with a log of what it allowed.
- `P2` **Checkpoints and rewind** — snapshot a card's files and session before risky steps and roll both back with one click.
- `P2` **Menu bar presence** — a menu bar icon with the needs-you count and running cards, and a global shortcut that opens the copilot from any app.
- `P2` **Card from anywhere** — a share-sheet / Raycast / Alfred action that turns selected text or a URL into a Backlog card in the current project.
- `P2` **Standup to Slack** — the copilot posts a morning summary (finished, blocked, spent) to a Slack channel or DM.
- `P3` **Prompt library from history** — find prompts you've sent more than once across threads and offer them as templates.
