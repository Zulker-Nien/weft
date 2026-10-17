# SOUL.md: who I am

I am Weft, a desktop kanban board where every card is a Claude Code, puku-cli or Codex thread, with a
browser pane beside the board and a copilot that runs the board. The weft is the thread that crosses
the loom and binds separate threads into cloth; I bind your agent threads into work.

I am built for builders and product managers: the ultimate creation tool. You bring the idea; I run
the threads that plan it, build it, show it in the browser pane and walk you through the review.

If you are an agent editing this repo, you are working on me. Read README.md for features.

## What I value

- **Speed first.** Claude Code and puku-cli are warm and pre-started (spares, keep-alive), so a reply starts in ~2s.
  Codex starts one CLI process per turn and resumes its saved session. Never add work to the start-a-card path without measuring it.
- **No git worktree per card, on purpose.** Worktrees cost a fresh checkout, `npm install` and env
  setup per card, and leave stray folders behind (like `fervent-tu-abd214`). I prefer cheap safety:
  busy-folder and overlap warnings.
- **Screen space is precious.** The user runs me maximized on a 13" MacBook Air (~1280x800 pt),
  often with the browser pane and thread panel open, leaving the board a few hundred px. Never add
  rows or chips just to show structure; fold it into existing controls (menus, counts, badges).
  Check the live window size before designing UI: `~/Library/Application Support/Weft/*-window.json`.
- **I'm always showing you something, every turn.** The browser pane is never idle and never stale.
  Every reply, even a one-line answer, leaves something current for that turn in the pane: the app,
  a web page, or an HTML page the thread writes itself (commits, plans, diffs, test runs, answers).
  The rule lives in `BROWSER_PROMPT` (`lib/browser-tools.ts`); `lib/glance.ts` backs it up with a
  starter page and a Haiku-written update page when a turn showed nothing.
- **I fix myself.** Every thread working in me should be looking for ways I could be better. When
  you spot one, you may start a card to fix it without asking: call `mcp__board__list_cards`
  first to avoid a duplicate, then `mcp__board__create_card` (it starts the card in the thread's
  folder by default). Tell the user you did.
- **Growth mindset.** I'm good and I get better. I follow Refactoring, 2nd ed. (Fowler):
  - tests before refactoring; small behavior-preserving steps
  - "make the change easy, then make the easy change"
  - name the smell (Long Function, Large Class, Duplicated Code, Feature Envy) before fixing it
  - hotspots: components/Board.tsx (~850 lines), electron/main.cjs (~490), electron/vault.cjs (~390), electron/browser-pane.cjs (~345), lib/cloud-sync.ts (~365).
    Everything else is under 300 (2026-10-16): big files became re-exporting fronts (`lib/types.ts` → `lib/types-*.ts`,
    `lib/import.ts` → `lib/import-*.ts`, `lib/secret-guard.ts` → `lib/secret-guard-*.ts`, `lib/client.ts` → `lib/client-*.ts`).
    Pure logic already moved out: `lib/board-view.ts` (columns, project chips, chime/unseen rules) and
    `lib/turn.ts` (how a turn's result reads, cost, limits); Board's hooks into `lib/use-*.ts` (`use-now`,
    `use-toast`, `use-desktop-bridge`, `use-copilot-card`, `use-board-actions`, `use-board-toggles`, `use-board-view`, `use-board-archive`,
    `use-board-card-actions`, plus `lib/board-focus.ts`, `lib/board-helpers.ts`) and its JSX into `BoardHeader`, `BoardColumn`, `BoardToast`.
    Next: the dialog stage and footer into a `BoardFrame`, the event handlers into a hook.
  - My Vitest suite (`pnpm test`, ~3,500 tests) covers every line of `lib/` and `app/api/` (98.6% of branches,
    `pnpm coverage`): a test file beside each module, routes with their libs mocked, the runner's SDK loop
    against a fake `query()` (`lib/runner.harness.ts`, shared by `lib/runner*.test.ts`), and browser code and React hooks under happy-dom +
    @testing-library/react (`// @vitest-environment happy-dom`). Component tests have started under jsdom
    (`components/*.test.tsx`: CardView, ReplyBox, NewCardDialog, TagsDialog, TagsDrawer, ThreadPanel, ColumnHeader, SettingsDialog, LibraryRail; Composer stubbed by `components/composer-mock.tsx`);
    `electron/main-menu-popup.test.ts` is the first test in `electron/`. The rest of `components/` and `electron/`
    are untested and outside the coverage set; add tests with any risky change, and keep new lib code at 100%.

## How I work (file map)

- `electron/main.cjs`: shell; starts Next, windows, tray, dock, `weft://` links, global hotkey;
  `electron/startup-screen.cjs` runs the start screen and shows why the board didn't load (Retry, Logs, Quit);
  `electron/startup-timer.cjs` times every launch into `~/.weft/startup.jsonl` (`node electron/startup-timer.cjs` lists them).
- `electron/browser-pane.cjs`: native browser pane, one page per card; token-guarded control
  server on 127.0.0.1 for agents, IPC for the board (`electron/preload.cjs`); `electron/pane-pages.cjs`
  saves each card's page to `~/.weft/pages/` so it comes back after a restart.
  `electron/pane-error.cjs` shows a failed load's reason, with Try again and Back, instead of Chromium's blank page.
- `electron/menus.cjs` + `electron/keep-working.cjs`: app menu, menu bar icon, dock; Keep Working (awake with the lid shut, until threads finish).
- `electron/updater.cjs` + `scripts/release-feed.mjs` + `.github/workflows/release.yml`: updates from GitHub Releases (Squirrel.Mac's JSON
  feed, a download fallback when unsigned) and the tag-triggered signed release; `CHANGELOG.md` holds each version's notes (docs/architecture/updates.md).
  `scripts/bundle-toolchain.mjs` stages what the app ships for a fresh Mac (node, npm, pnpm, puku-cli without telemetry, claude, all on
  my own Electron), which `appendToolchain()` in `electron/env.cjs` puts at the end of PATH.
- `electron/folder-access.cjs` + `lib/folder-access-tool.ts`: `mcp__board__request_folder_access`, called by a thread that got "Operation not permitted" on
  Downloads, Documents or Desktop (never on launch): lists the folder so macOS shows its allow prompt, else a dialog with an Open Settings button.
- `lib/folder-guard.ts` + `app/api/folders`: the folder gate, a PreToolUse hook that asks before a file tool or Bash command reaches outside the card's project (Allow once / This card / Always, `settings.allowedFolders`); in every thread via `guardedCli()` (docs/architecture/thread-guards.md).
- `electron/terminal.cjs` + `components/TerminalDrawer.tsx`: the terminal drawer (node-pty shell over IPC, xterm.js).
- `lib/runner.ts`: one Agent SDK `query()` per Claude Code or puku thread, its public API (send, queue, stop, retry, login); Codex uses `lib/codex-runner.ts` with `codex exec --json` and resumes by session id. Behind it
  `lib/runner-state.ts` (sessions, shared maps, `hooks` back into runner.ts), `lib/runner-session.ts` (start and drive a CLI,
  warm spares, the BUILD fingerprint), `lib/runner-turn.ts` (what the CLI sends during a turn) and `lib/runner-ask.ts` (permissions);
  puku-cli via `pathToClaudeCodeExecutable` (`lib/cli-path.ts`), whose gateway drops the system prompt, so its first message carries
  the folder, CLAUDE.md/AGENTS.md and Weft's prompt instead (`lib/puku-context.ts`); every CLI starts in its own process group so its children end
  with it (`lib/cli-process.ts`), and `lib/cli-reaper.ts` ends the orphans a killed server left behind. The init's model plus the effort (the card's, else `effortLevel` from the CLI's settings, `lib/cli-defaults.ts`)
  land in `stats.runsOn`, which the header's CLI chip shows (`BackendBadge`). `editLastMessage()` is ↑ in the reply box: it rewinds the
  session to before your last message (`lib/edit-last.ts`, `lib/rewind.ts`) and sends the edit.
- `lib/env.ts` `guardedCli()`: Claude Code and puku-cli's CLI env and Bash guards: `lib/secret-guard.ts` (no .env reads),
  `lib/restart-guard.ts` (no restarting Weft mid-turns), `lib/git-guard.ts` (no `git stash`, `reset --hard`, path
  checkout/restore or `clean -f` in the shared tree), `lib/check-guard.ts` (no `tsc` or `eslint` run directly where the
  project's `pnpm typecheck`/`pnpm lint` take turns through `scripts/one-at-a-time.mjs`; plain Claude Code sessions get it from `.claude/settings.json`), `lib/route-import-guard.ts` (refuses an edit that makes `app/**/page.tsx`,
  a layout, a `route.ts` or middleware import a module that isn't there yet), `lib/claim-guard.ts` (symbol claims: asks before an edit to a top-level
  symbol another busy card is editing; `lib/claims.ts`, parsed by `lib/symbols.ts`) (docs/architecture/thread-guards.md).
  Codex gets the filtered `cliEnv()` but not these per-tool hooks; `lib/codex-runner.ts` asks it not to read `.env` files. It does get
  Weft's MCP tools, over HTTP: `lib/weft-mcp.ts` builds the servers every CLI gets, `lib/mcp-bridge.ts` opens a per-turn token and
  `app/api/mcp/[server]` serves them to `codex exec --config mcp_servers.*`. Puku and Codex don't read `.claude/skills` or Codex `CLAUDE.md`,
  so `lib/skills.ts` `skillIndex`/`skillInvocation` list a folder's skills and expand `/name`, and `lib/puku-context.ts` sends Codex the project's `CLAUDE.md`. `cliEnv()` also drops secret-named and key-shaped variables from your shell's env (`lib/secret-detect.ts`); the control
  server's token is a 0600 file, `~/.weft/shell-token` (`electron/shell-token.cjs`, read by `lib/shell-token.ts`), never an env var.
- `scripts/check-staged.sh` + `scripts/secret-scan.mjs`: the pre-commit hook; gitleaks, or without it Weft's own key shapes on each added line.
  The Composer flags a pasted or typed key the same way (`components/SecretPaste.tsx`).
- `lib/schedule.ts` + `lib/scheduler.ts` + `components/SendLater.tsx`: "Send later" replies; the server sends them at their
  time, by default the next 5-hour reset.
- `lib/shell.ts` + `lib/bang.ts` + `app/api/cards/[id]/shell`: `!` in a reply box runs a shell command in the card's folder; its
  output shows in the thread (`ShellLine` in `components/ThreadItems.tsx`) and goes to Claude with your next message.
- `lib/status.ts` + `lib/settings.ts`: the BOARD STATUS protocol (thread prompt and its parser).
- `components/QuestionForm.tsx` + `components/QuestionParts.tsx` + `lib/question-answers.ts` + `lib/question-keys.ts` +
  `lib/question-preview.ts`: a thread's AskUserQuestion, asked the Claude Code way above the reply box, whose composer is its
  one input (own answer or a note, sent as `annotations`); option previews open in the card's browser pane; text typed on the
  Submit tab goes with the answers as a note on all of them (`buildReply`'s `general`).
- `components/SettingsDialog.tsx` + `lib/settings-nav.ts`: Settings, full window over a scene, six pages down the left (General, Models,
  Threads, Automations, Shortcuts, Accounts); Models holds every model pick, new threads' through `components/NewThreadDefaults.tsx`;
  the four rows (NewThreadDefaults, SubagentPicker, CopilotPicker, DonePicker) share `components/Pickers.tsx`
  (`BackendPicker`, `ModelPicker`, `EffortPicker`) on top of `components/ModelSelect.tsx` (Claude / Puku / Codex optgroups driven by `MODELS` in `lib/new-thread.ts`; Copilot passes `groups=Claude` to stay Claude-only).
- `lib/subagents.ts` + `components/SubagentPicker.tsx`: when threads delegate to subagents and on which model (Settings → Models → Use for subagents,
  any Claude or Puku model: forced through `CLAUDE_CODE_SUBAGENT_MODEL` / `PUKU_CLI_SUBAGENT_MODEL` on its own CLI, a headless `-p` run on the other).
- `lib/automations.ts` `doneOverrides` + `components/DonePicker.tsx`: Settings → Models → Run /weft:done on picks the model (any Claude or
  Puku model, applied to cards on its own CLI) and effort `/weft:done` uses on a Done move; both model menus are `components/ModelSelect.tsx`; `app/api/cards/[id]` moveCard snapshots the card's own picks into `preDoneModel` /
  `preDoneEffort` and `lib/runner.ts` `restoreDoneOverride` puts them back after the wrap-up.
- `components/ReviewAllPicker.tsx`: Settings → Models → Review all picks the Claude model of the Review column's "Review all" card (`reviewAllModel`; `Board.tsx` `reviewAll` reads it at click time).
- `components/CopilotPicker.tsx`: Settings → Models → Copilot picks the Claude model the copilot thread runs on. The pick is read once when the
  card is first made (`lib/copilot.ts` `ensureCopilot`), so it takes effect on the next "New chat" in the copilot lane; the default follows the model
  you last picked for new threads (`lib/new-thread.ts` `modelFor`).
- `lib/puku-trial.ts` + `lib/puku-trial-token.ts` + `lib/puku-proxy.ts` + `app/api/puku/*`: the Puku trial; a puku thread with no Puku
  login, while you're signed in to Weft, runs through the deployed Weft's proxy on Weft's own key (signed day-long token read by puku's
  `apiKeyHelper` from `~/.weft/puku-trial-token`, per-account daily cap in `puku_trial_usage`; docs/architecture/puku-trial.md).
- `lib/billing/*` + `lib/billing-actions.ts` + `app/[orgSlug]/billing` + `app/api/billing/*` + `components/BillingStatus.tsx`:
  Free and Pro per workspace (@aimhuge/billing; Pro meters Puku tokens in the proxy through PlanMeter; docs/architecture/billing.md).
- `lib/home.ts` + `lib/home-release.ts` + `components/home/*` + `components/GoogleAnalytics.tsx` + `components/HomeErrorFallback.tsx` +
  `app/home/page.tsx` + `app/opengraph-image.tsx` + `public/brand/board.png`: the weft.zip home page, which `app/page.tsx` renders at
  `/` instead of the board when `isDeployed()` (`VERCEL` or `WEFT_HOME`); the home is loaded through `loadHome()` (a cached dynamic
  import in `lib/home.ts`) so a parse error in it can't 500 the board route — the parse-error companion to
  `lib/route-import-guard.ts`; `home.css` is plain prefixed CSS because `next.config.ts` sends every `.css` through the Tailwind loader,
  which drops CSS-module exports. `GoogleAnalytics` (gated on the home being mounted, so the board route never calls home) and
  `HomeErrorFallback` (the dark plain page both routes render when `loadHome()` returns an error) are both server components;
  `docs/architecture/analytics.md` covers GA.
- `lib/file-drop.ts` + `lib/use-file-drop.ts` + `components/FileDrop.tsx`: files dragged from Finder anywhere in the window; a composer takes
  its own drop, a card opens with them in its reply box, an open thread (`data-drop-target`) gets them, empty board opens New thread; files wait
  in the store until the target composer (`dropTarget`) mounts.
- `lib/review.ts`, `lib/devserver.ts`: `weft-review` tour blocks and the card's dev server.
- `plugin/skills/*`: my own skills (`/weft:done`, `/weft:commit`, `/weft:preview`, `/weft:setup-done`,
  which installs tests, docs and strict lint on a project before `/done`; `/weft:done` also keeps this file current);
  `lib/skills.ts` lists skills, `lib/automations.ts` turns "When … run …" rules into turns.
- `lib/quality.ts` + `lib/quality-view.ts` + `app/api/quality`: the header's code quality checklist (coverage via `lib/coverage.ts`,
  file size, lint, types, guardrails); `lib/scout.ts` + `lib/scout-view.ts` + `app/api/scout`: the refactor scout, a cached
  read-only Sonnet run whose findings take the score's last 10 points so it never hits 100. `components/QualityBadge.tsx`
  draws it, `components/ScoutMenu.tsx` starts a card per finding; its hover bubble is `components/Tip.tsx` (native titles don't show in Electron).
- `lib/activity.ts` + `lib/game*.ts` + `lib/craft.ts` (the skills each Done card's transcript ran, behind Craft) + `lib/project-checks.ts` + `app/api/game`: streaks, XP, badges, the builder card and the
  production-ready tree, from the append-only `~/.weft/activity.jsonl`; `components/GameBadge.tsx` is the header chip and
  `components/LoomDialog.tsx` its dialog (docs/architecture/gamification.md).
- `lib/commit-pile.ts` + `app/api/pile` + `components/PileBadge.tsx`: the header's "+N/-N" uncommitted counter and the card it
  starts to commit that pile one Review card at a time; its page's Commit buttons are `weft://commit` links
  (`electron/page-links.cjs`) that `lib/pile-commit.ts` runs with no turn (commit by path, push, move to Done).
  The Review column's "Review all" button starts the same card through the shared `lib/pile-review.ts`
  helper.
- `lib/sprint-plan.ts` + `app/api/sprint` + `components/BacklogBadge.tsx`: the "☰ N" Backlog counter beside it and the card it starts,
  a read-only planner that sizes each Backlog card, flags duplicates and finished ones, and groups the rest into sprints of cards
  touching different files (no worktrees, so overlap is the constraint); starts a sprint's cards only on your OK.
- `lib/card-pictures.ts`: a card's thumbnail (latest thread image, or a pane capture after each turn from `lib/glance.ts`) and its Haiku emoji tile; `lib/retitle.ts` renames a card with a placeholder title ("Image attachment") after its turn (`titleBy` marks a name Weft or you chose) and gives an untagged card 1 to 3 tags in the same Haiku call (`tagsBy`); `components/CardView.tsx` draws the card.
- `lib/tags.ts` + `lib/tag-store.ts` + `app/api/tags` + `lib/rail-view.ts` + `components/LibraryRail.tsx` (`SideRail`) + `components/TagsDrawer.tsx` +
  `components/TagsDialog.tsx` + `components/CardMarks.tsx` + `components/StarButton.tsx`: ★ star (never auto-archived; the rail's ★ filters
  the board) and tags (GitHub label rules, catalog in `~/.weft/tags.json`, the 🏷 drawer, pills on the card's stage line); they replaced the
  library (docs/architecture/tags.md).
- `lib/github-issues.ts` + `app/api/github/issues`: a project's open GitHub issues become Backlog cards through the `gh` CLI, labels as tags,
  one direction; opt-in folders in settings `issueFolders`, polled from `prewarm()` every 5 min (docs/architecture/github-issues.md).
  `lib/github-status.ts` + `app/api/github` + `lib/github-view.ts` + `lib/use-github.ts` + `components/GithubDrawer.tsx`: the rail's GitHub drawer
  (the `gh` sign-in, each project's repo and its issue sync switch). `lib/github-hooks.ts` + `app/api/github/hooks` +
  `lib/github-relay.ts` + `app/api/github/webhook`: instant sync, a repo webhook relayed by the deployed Weft on Vercel (→ `github_events` on Supabase → Realtime).
- `lib/email-forward.ts` + `app/api/email/webhook` + `scripts/resend-domain.mjs`: mail to weft.zip, received by Resend (the domain's MX) and
  forwarded by the deployed Weft to one inbox (Svix-signed `email.received` → read back → send on; docs/architecture/email-forwarding.md).
- `lib/account.ts` + `app/api/account` + `lib/auth/*` + `lib/use-account.ts`: the optional Weft account
  (Supabase Auth, PKCE; the redirect target is `weft://account-callback` in the packaged app and the loopback
  HTTP origin in `next dev`, handled by `electron/account-link.cjs` and `app/api/auth/weft-callback/route.ts`;
  sign-in / sign-out pages share `lib/account-page.ts`). `lib/auth/` is a thin wrapper around the same
  `lib/account.ts` whose public API mirrors `@aimhuge/auth`; `app/login/page.tsx` is the new weft.zip sign-in
  surface (GitHub only). `lib/use-account.ts` is a board-side re-export of `useAuth` with the
  `{ state, busy, error, waiting, signIn, sendLink, signOut }` shape the top bar expects. Session in
  `~/.weft/account.json` (Keychain-sealed by `electron/account-store.cjs`), drawn by
  `components/AccountButton.tsx` (top bar) and `components/AccountSettings.tsx`; schema in
  `supabase/migrations/`, MCP server in `.mcp.json`.
- `lib/teams.ts` + `lib/team-actions.ts` + `lib/web-session.ts` + `lib/web-auth.ts` + `proxy.ts` + `app/auth/*` + `app/team` +
  `app/[orgSlug]/*` + `app/invite/[token]` + `components/team/*`: Weft teams on weft.zip (workspaces, roles, email invites; every
  account gets one through `supabase/migrations/20261013170000_teams.sql`), on the visitor's own cookie session. Uses `@aimhuge/teams`
  (`vendor/*.tgz`) for its helpers only: its `requireOrg` and actions pass a client into `"use cache"`, which Next 16 refuses, so the
  gate is Weft's own. Never pass the gate's `service` client to a client component (docs/architecture/teams.md, teams-vault.md).
- `electron/vault*.cjs` + `electron/dotenv.cjs` + `electron/device-key.cjs` + `components/VaultDrawer.tsx`: the 🔐 secrets vault
  (docs/architecture/secrets.md); decryption only in main, IPC to the board window only, `lib/vault-view.ts` + `lib/use-vault.ts` on the board side.
  A thread that needs a key it doesn't have puts the name in as a blank right away with `mcp__secrets__add_blank` (with a hint for where
  to get the value) — blanks sort first, the rail's badge counts them, every blank row has a visible **Fill in** button, and the user
  fills them in when they're ready. `mcp__secrets__ask_add` is the urgent path: an input for the key in the thread itself (`components/SecretAskInput.tsx`).
- `lib/webhooks.ts` + `lib/webhook-tools.ts` + `app/api/webhooks` + `lib/use-webhooks.ts` + `lib/webhooks-view.ts` + `components/WebhooksDrawer.tsx`: the 🪝
  webhooks drawer under 🔐 (each project's webhook routes in `~/.weft/webhooks.json`, blanks counted until registered; `mcp__webhooks__*`).
  `lib/webhook-relay.ts` + `app/api/hooks/[id]` + `lib/webhook-forward.ts`: its public relay URL on the deployed Weft (→ `webhook_deliveries` on
  Supabase → Realtime → the local target; docs/architecture/webhooks.md).
- `electron/vercel*.cjs` (`vercel-env.cjs`: 🔐 vault → Vercel env push, Touch ID per push, also `mcp__secrets__push_to_vercel`; and `pull()`: plain Vercel vars the vault lacks → vault, by hand or live: `lib/vercel-hooks.ts` + `app/api/vercel/hooks` make the team webhook and listen, `lib/vercel-relay.ts` + `app/api/vercel/webhook` relay it on the deployed Weft → `vercel_events` on Supabase → Realtime) + `lib/vercel-view.ts` + `lib/use-vercel.ts` + `lib/use-linked-status.ts` (the three drawers' cached status hook) + `components/Vercel*.tsx`: the ▲ Vercel drawer (token sealed
  in the Keychain, link or create a project as `.vercel/project.json`, latest deploy; docs/architecture/vercel.md).
- `electron/supabase.cjs` + `lib/supabase-view.ts` + `lib/use-supabase.ts` + `components/Supabase*.tsx`: the Supabase drawer (its bolt
  on the rail; token sealed in the Keychain, link a project as `supabase/.temp/project-ref`, state, unapplied migrations matched by version then name;
  `lib/supabase-migrate.ts` is the prompt of **Migrate**, the card that applies them on your OK; docs/architecture/supabase.md).
- `electron/cloudflare*.cjs` + `lib/cloudflare-view.ts` + `lib/use-cloudflare.ts` + `components/Cloudflare*.tsx`: the Cloudflare drawer (its orange
  cloud on the rail; a pasted setup token becomes Weft's own narrow token, sealed in the Keychain, then the setup token is deleted; link a Worker or Pages project in `~/.weft/cloudflare-links.json`, best fit from the
  folder's wrangler config; docs/architecture/cloudflare.md).
- `electron/blastcp*.cjs` + `lib/blastcp-view.ts` + `lib/use-blastcp.ts` + `components/BlastcpDrawer.tsx`: the BlastCP drawer (its rocket logo on the rail, `components/BlastcpLogo.tsx`) (OAuth + PKCE
  sign-in sealed in the Keychain, reads through BlastCP's MCP tools, folder → property links in `~/.weft/blastcp-links.json`; docs/architecture/blastcp.md).
- The board's native right-click menus (lib/card-menu.ts) are built and popped in `electron/main-menu-popup.cjs`:
  one IPC handler, a fresh `Menu` from the items the board sends, the click → resolve wiring behind a `setTimeout`
  (because click fires before the callback on macOS but not on every platform). `Menu` and `BrowserWindow` are
  injected so the test can pass mocks without a real Electron.
- `lib/copilot.ts` + `lib/board-tools.ts`: the copilot thread and its `mcp__board__*` tools. `lib/copilot-suggest.ts` + `lib/copilot-context.ts` + `lib/copilot-sources.ts` + `lib/copilot-setup.ts` (what isn't linked yet, for onboarding chips and the copilot's `setup_status`) + `app/api/copilot/suggestions`: the empty chat's chips Haiku writes from the cards and every source Weft can read (pile, scout, blanks, Vercel and Supabase via the control server's `/vercel/status` and `/supabase/status`, `gh`), refreshed in the background after a move. `components/CopilotLane.tsx` +
  `lib/copilot-lane.ts` + `lib/use-copilot-thread.ts`: its lane on the right of the board with three states,
  like Intercom's hider: hidden (a 36px pill, the default), peek (a 236px digest column), open (a 520px chat
  over `public/copilots/wingman.jpg`, the cockpit); ⌘J cycles them via `LANE_CYCLE` and the two
  `weft-copilot-lane` / `weft-copilot-peek` cookies in `lib/board-prefs.ts`. The board's columns
  keep their 170px floor when hidden and narrow to 120px when peek or open (`columnMinWidth(state)`);
  the peek auto-closes 6s after the mouse leaves so the board reclaims the width. They
  are `@container`s that drop thumbnails and header extras.
- `lib/browser-tools.ts`: `mcp__browser__*` tools every thread gets.
- Browser pane: `components/BrowserPane.tsx` draws the toolbar and the placeholder the native view (`electron/browser-pane.cjs`)
  lies over; `components/GlanceRail.tsx` + `lib/glance-rail.ts` + `lib/glance-events.ts` + `lib/pane-page.ts` (stamps each sent message with the pane's page) are the 72 px glance rail right of the page,
  one mini per turn and per page the pane showed (the thread's `open_url` calls plus pages opened by hand, in memory), synced with the chat by two window events (`glance:scroll-to`, `glance:pulse`) on rows tagged `data-turn` (docs/architecture/glance-rail.md).
- `lib/board-view-tools.ts` + `electron/board-view.cjs` + `electron/control-server.cjs`: `mcp__board_view__*`, a thread's eyes and hands
  on the board window itself (screenshot, click, hover, type, read; fixed scripts, no arbitrary JS; `data-secret` reads as ‹secret›,
  `data-secret-action` can't be clicked) through the pane's token-guarded control server (docs/architecture/board-view.md).
- `lib/import.ts`, `lib/search.ts`: pick up `~/.claude/projects` sessions as cards; search index.
- `lib/hotkeys.ts` + `lib/shortcut-catalog.ts`: the keyboard shortcut registry and what the `?` sheet lists; tooltips, key badges,
  right-click menus and `ModifierHint` read their keys from it (docs/architecture/keyboard-shortcuts.md).
- `lib/new-thread.ts` + `components/submit-keys.ts` + `lib/use-mod-held.ts`: what the New thread dialog offers and remembers (CLIs, models,
  effort, drafts), and its start keys: ⌘↵ starts and closes, ⌃↵ starts and stays open, and holding either relabels Start.
- `lib/theme.ts` + `app/api/scenes` + `components/AppearancePicker.tsx` + `electron/theme-source.cjs`: System, Light, Dark or a scene
  (one of Weft's pictures behind the board with its own palette, in `app/globals.css`; docs/architecture/themes.md).
- `lib/store.ts`: storage in `~/.weft` (board.json, threads/, attachments/).
- `lib/cloud-sync.ts` + `lib/cloud-outbox.ts` + `lib/cloud-sync-start.ts` + `lib/blob-store.ts` + `lib/device-id.ts` + `lib/cloud-sync-types.ts`:
  server-side cards, opt-in per folder (settings `syncFolders`): an outbox in `~/.weft/sync-outbox.jsonl` uploads cards, thread items
  and long tool outputs to Supabase (`supabase/migrations/20261015140000_card_sync.sql`), images and pages by content hash.
  `lib/thread-page.ts` + `app/api/cards/[id]/thread/**` + `lib/use-tool-result.ts`: threads page from the newest item back and fetch
  a tool output over 2 KB when its row opens (docs/architecture/cloud-sync.md).
  `app/[orgSlug]/board` + `components/web-board/*` + `lib/web-board.ts`: the weft.zip board is the desktop's own `CardView` (`readOnly`),
  `ColumnHeader`, `lib/board-view.ts` and `ThreadEntries` over Realtime, not a lookalike; change the desktop card or thread and the web follows.
  `lib/cloud-commands.ts` + `lib/cloud-inbox.ts` + `lib/new-card.ts` + `lib/web-commands.ts` + `components/web-board/WebNewCardDialog.tsx`: **New thread** on the web board
  inserts a `cloud_commands` row (`supabase/migrations/20261016130000_card_commands.sql`); the Mac it names hears it over Realtime, checks it (its device, its account, a
  synced folder, its workspace), makes the card through the same `createCardFromBody` as `POST /api/cards`, starts it and reports back; the card syncs up like any other.
- `app/api/*` + `lib/guard.ts`: localhost-only Host check, writes need `x-threadboard: 1`.
- `lib/restart-guard.ts`: turns away Bash that would kill or restart Weft itself (its server pid, port, `next dev`, the app)
  while other cards' turns run, since a restart cuts them all off; in every thread via `guardedCli()`.
- `lib/restart-when-idle.ts` + `app/api/restart` + `lib/restart-tool.ts` + `electron/restart-when-idle.cjs` + `components/RestartChip.tsx`: restart when idle
  (Weft menu, palette, updater, `mcp__board__restart_weft_when_idle`): `sendMessage` holds new turns as "after restart" scheduled
  messages, and once no turn runs or is queued the server calls the control server's `POST /app/restart` (relaunch or install the update).
- `lib/import-check.ts` + `lib/dropped-imports.ts`: after each Edit/Write, tells the thread which imports it broke (a build error no boundary catches) or dropped while still in use (an "X is not defined" on draw);
  in every thread via `lib/env.ts` `guardedCli()`, and in other Claude Code sessions via `.claude/settings.json`.
- Components: `Board.tsx`, `ThreadView.tsx`, `ThreadItems.tsx`, `Markdown.tsx`, `ReviewPanel.tsx`;
  every dialog sits in `Modal.tsx` (backdrop, header, close, Escape via `lib/use-escape.ts`);
  each card, panel, dialog body, drawer, header badge and thread message sits in `CrashGuard.tsx` (an error boundary;
  `inline` draws a one-line chip for small spots), with `app/error.tsx` behind the whole board. Board's panels, dialogs,
  cards and badges, the reply box and the review panel load through `guarded()` (`components/guarded.tsx`, an `import()`
  inside a CrashGuard), so even a module that throws as it loads (JSX in a constant before its import) breaks only its spot.
  A build error (a file that doesn't parse) fails the route before React runs, so no boundary sees it: `components/BuildErrorBar.tsx`
  (`lib/build-error.ts`) hides Next's overlay and leaves the last version that built running.
- Deeper docs (read the one that matches your task; this is the index, not the docs themselves):
  - `admin.md` — the super-admin gate (`SUPER_ADMIN_EMAILS` on `@aimhuge/teams` via `lib/admin.ts`), the `/admin/users` and `/admin/settings` pages, the rail's 🛡 Admin icon, the data routes in `app/api/admin/*`.
  - `overview.md` — what Weft is end to end: the Electron shell, the Next.js server, cards-as-threads, the loop with the user.
  - `desktop-shell.md` — `electron/` itself: main, preload, tray, dock, `weft://` links, the start screen, the terminal drawer.
  - `threads-and-sessions.md` — the runner: one Agent SDK `query()` per Claude Code/puku thread, the Codex runner, sessions, queues, rewind, warm spares.
  - `thread-guards.md` — what `guardedCli()` strips and hooks: secret/restart/git/check/route-import/claim guards, per-CLI limits.
  - `questions.md` — a thread's AskUserQuestion end to end: the panel above the reply box, keys, previews in the pane, answers and `annotations` back to the CLI.
  - `subagents.md` — how threads delegate to subagents and how Settings → Models picks their model.
  - `account.md` — the optional Weft account (Supabase Auth, PKCE, `weft://account-callback`, `~/.weft/account.json` in the Keychain).
  - `teams.md` — workspaces, members, roles, email invites on weft.zip; the `requireOrg` gate and why it's not `@aimhuge/teams`'s.
  - `teams-vault.md` — the shared 🔐 vault, step 4 of `secrets.md`; team shapes and what's built vs. design.
  - `billing.md` — Free and Pro per workspace, `@aimhuge/billing`, PlanMeter, what's built and what's still TODO.
  - `secrets.md` — the 🔐 vault: device key, on-disk encryption, IPC, Touch ID, agent tools, dev-server env, Supabase sync.
  - `webhooks.md` — the 🪝 rail drawer, the `mcp__webhooks__*` tools, the relay URL, `webhook_deliveries` on Supabase.
  - `vercel.md` — the ▲ rail drawer: token in the Keychain, `.vercel/project.json`, env push from the vault, deploys, `vercel_events` Realtime.
  - `supabase.md` — the Supabase rail drawer: token in the Keychain, `supabase/.temp/project-ref`, state, unapplied migrations, the Migrate card.
  - `cloudflare.md` — the orange-cloud rail drawer: API token in the Keychain, Worker/Pages links in `~/.weft/cloudflare-links.json`, wrangler `account_id` and deploys.
  - `blastcp.md` — the BlastCP rail drawer: OAuth+PKCE, MCP-tool reads, `~/.weft/blastcp-links.json`.
  - `puku-trial.md` — the puku trial: a puku thread with no Puku login runs through the deployed Weft's proxy on Weft's own key, day-long token, per-account daily cap.
  - `email-forwarding.md` — `weft.zip` mail → Resend → Svix-signed `email.received` → one inbox.
  - `github-issues.md` — a project's open GitHub issues become Backlog cards, one direction, polled every 5 min, instant sync via the deployed relay.
  - `tags.md` — ★ star and tags (the GitHub-label-style rules, the catalog in `~/.weft/tags.json`, the 🏷 drawer, pills on the card); replaced the library.
  - `glance-rail.md` — the browser pane's 72 px rail of one mini per turn and per page, its dots, fallbacks and browser history, and the two events that sync it with the chat.
  - `board-view.md` — `mcp__board_view__*`: a thread's eyes and hands on the board window itself, fixed scripts, the token-guarded control server.
  - `keyboard-shortcuts.md` — the shortcut registry, the `?` sheet, tooltips, key badges, the `ModifierHint` component.
  - `themes.md` — System/Light/Dark and a scene (one of Weft's pictures behind the board with its own palette).
  - `error-boundaries.md` — `CrashGuard.tsx`, `BuildErrorBar.tsx`, the `guarded()` import wrapper, why a build error never reaches a boundary.
  - `gamification.md` — the header's 🔥 chip and "Your loom" dialog: streaks, XP, badges, the builder card, the production-ready tree.
  - `quality.md` — the header's code quality checklist: coverage, file size, lint, types, guardrails; the refactor scout and the score's last 10 points.
  - `commit-pile.md` — the header's "+N/-N" uncommitted counter and the Review card that walks the pile to a clean commit.
  - `updates.md` — the Squirrel.Mac JSON feed, the download fallback, the tag-triggered signed release, `CHANGELOG.md` notes.
  - `keep-working.md` — the menu bar icon's switch to keep the Mac awake with the lid shut so threads keep running in a bag.
  - `analytics.md` — GA4 on the home page only; `GoogleAnalytics` is gated on the home being mounted, so the board route never calls home.
  - `cloud-sync.md` — server-side cards: the outbox, the content-addressed blob store, thread paging, the `cloud_*` tables and their policies.

  When a new doc lands in this folder, add it here on the same change.

## Using my secret store

The 🔐 on the left rail is a vault per project (keyed by its GitHub repo): values encrypted on disk, decrypted only
in Electron main, revealed or copied only after the user's Touch ID (docs/architecture/secrets.md).

- **A secret's value never enters your context.** Work with names (`GITHUB_CLIENT_SECRET` in the weft vault); I put
  values in at the edge. A value you've seen is in the model request and in plaintext transcripts for good.
- **When a task needs a value** (a provider's client secret into Supabase, a key into a dashboard): fill it in yourself,
  never ask the user to paste it. `mcp__secrets__list` gives the names in the card's vault (or another project's, by
  path); open the page with the field in the browser pane, then `mcp__secrets__fill_field(name, selector)`. Electron main
  asks for Touch ID (naming the secret, vault and site; then 3 free minutes for that card on that site), types the value
  in and masks the field; `read_page` shows it as `‹NAME›`. https pages only. Built in `lib/secret-tools.ts`,
  `electron/pane-secrets.cjs` and `vault.useFor()` in `electron/vault.cjs`.
- **Never go around it.** Don't read `.env*`, `~/.weft/vault/` or `~/.weft/device-key.json` (`lib/secret-guard.ts` denies
  them), and never write a script that loads the vault modules or `safeStorage` outside the app: that skips Touch ID
  even if it prints nothing.
- **When a command needs a value** (`pnpm run job` or a migration with `DATABASE_URL`, a CLI with an API token): call
  `mcp__secrets__run(command, names)`. The user approves the exact command, its `package.json` script and the names
  (once or always), main runs it with no shell and the values in its env only, and you get the exit code and output with
  each value as `‹NAME›`. One plain command: no pipes, redirects, `&&` or `$VAR` (put steps in a package.json script);
  shells, `node -e`, `printenv` and network tools are refused. Built in `lib/secret-run.ts` + `lib/secret-command.ts`
  and `electron/secret-run.cjs` (with `run-rules.cjs`, `secret-redact.cjs`). A card's dev server gets the development
  values through `electron/secret-env.cjs`. Values for HTTP requests (a Management API header) aren't built yet: say
  what's missing and ask.
- **When code needs a secret**: read it from `process.env.NAME` and add `NAME=` to `.env.example`, so the vault lists it as
  missing until the user fills it with 🔐 Add.
- **If the user pastes a key into the thread**: say it's now in the transcript, suggest rotating it at the provider,
  and keeping the new one in the vault.

## Conventions to keep

- End every board-thread reply with the BOARD STATUS line the thread prompt asks for; don't change
  its format without updating `lib/status.ts`.
- This Next.js differs from your training data: read `node_modules/next/dist/docs/` first.
  Leave the managed block in AGENTS.md alone.
- Run me in dev mode (`pnpm desktop`, or the `~/Applications/Weft.app` launcher, which opens
  Electron on this folder). Run `pnpm dist` only to ship a build to someone else; a local
  packaged `.app` goes stale with every commit.
- When a feature lands, update README.md and docs/ROADMAP.md in the same change, and add a line under Unreleased in CHANGELOG.md.
- Run `pnpm lint`, `pnpm typecheck` and `pnpm test` (Vitest; tests sit beside the code as `lib/*.test.ts` and `components/*.test.tsx`, the latter in jsdom with `// @vitest-environment jsdom` and `./test-utils`; API routes in `app/api/routes.test.ts`).
  `pnpm typecheck` and `pnpm lint` take turns across cards (`scripts/one-at-a-time.mjs`, as does the pre-commit hook's tsc);
  `lib/check-guard.ts` refuses `npx tsc` or bare `eslint`. To lint only your own files, `pnpm lint <files>`.
- Stage every new file a change imports. The pre-commit hook (`.githooks/pre-commit`, set up by
  `pnpm install`) type-checks the staged files alone and refuses a commit that imports an unstaged
  file. Never `git stash` in this tree: other threads' unstaged work lives here too.
- Weft uses pnpm (node-linker=hoisted in .npmrc, so node_modules stays flat for Electron); never
  run npm install here.

## Known gaps (verified 2026-10-13)

- Coverage counts only `lib/` and `app/api/` (100% lines, 98.6% branches on 2026-10-11). `components/` has
  behavior tests for CardView, ReplyBox, NewCardDialog, TagsDialog, TagsDrawer, ThreadPanel and ColumnHeader only
  (not Board, ThreadView or the real TipTap Composer);
  `electron/` has one (`electron/main-menu-popup.test.ts`). Runner's leftover branches are defensive fallbacks.
  CI (`.github/workflows/ci.yml`) runs lint, typecheck and tests, but the repo has no upstream branch yet, so it hasn't run.
- `lib/account.ts` declares `WEEFT_PROTOCOL` on line 101 and uses it on line 96 (forward reference). `ACCOUNT_CALLBACK_HOST`
  is duplicated in `lib/account.ts:94` and `electron/account-link.cjs:6`; one should import from the other.
- `7b1db11`, `dfdd9c7` and `0e54c6f` don't build on their own (Board.tsx imported files committed later);
  everything from `2766738` on does.
- The overlap warning (`lib/overlap.ts`) counts a card's edits for its whole life, committed or not. The reply box no longer
  shows it (in a busy repo it always did); the card's "+N here" chip and the New thread dialog do, and neither names the
  shared files. Symbol claims warn at the actual clash instead.
- Symbol claims (`lib/claim-guard.ts`) drop on Done, archive and the commit walk-through, not when a thread runs
  `git commit` itself; those stay until the card reaches Done.
- The copilot learns what finished or needs you only with your next message (`lib/copilot-digest.ts`);
  it never runs a turn on its own.
- puku-cli sessions aren't imported; a full puku thread hasn't been verified end to end.
