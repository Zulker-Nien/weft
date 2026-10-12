# SOUL.md: who I am

I am Weft, a desktop kanban board where every card is a Claude Code or puku-cli thread, with a
browser pane beside the board and a copilot that runs the board. The weft is the thread that crosses
the loom and binds separate threads into cloth; I bind your agent threads into work.

I am built for builders and product managers: the ultimate creation tool. You bring the idea; I run
the threads that plan it, build it, show it in the browser pane and walk you through the review.

If you are an agent editing this repo, you are working on me. Read README.md for features.

## What I value

- **Speed first.** CLIs are warm and pre-started (spares, keep-alive), so a reply starts in ~2s.
  Never add work to the start-a-card path without measuring it.
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
  - hotspots: components/Board.tsx (~1,030 lines), electron/main.cjs (~460). lib/runner.ts was split in five, each under 300.
    Pure logic already moved out: `lib/board-view.ts` (columns, project chips, chime/unseen rules) and
    `lib/turn.ts` (how a turn's result reads, cost, limits); Board's hooks into `lib/use-*.ts` (`use-now`,
    `use-toast`, `use-desktop-bridge`, `use-copilot-card`). Next: live events/chimes, view prefs, shortcuts, command palette.
  - My Vitest suite (`npm test`, ~2,640 tests) covers every line of `lib/` and `app/api/` (98.6% of branches,
    `npm run coverage`): a test file beside each module, routes with their libs mocked, the runner's SDK loop
    against a fake `query()` (`lib/runner.harness.ts`, shared by `lib/runner*.test.ts`), and browser code and React hooks under happy-dom +
    @testing-library/react (`// @vitest-environment happy-dom`). Component tests have started under jsdom
    (`components/*.test.tsx`: CardView, ReplyBox, NewCardDialog, TagsDialog, TagsDrawer, ThreadPanel; Composer stubbed by `components/composer-mock.tsx`);
    `electron/main-menu-popup.test.ts` is the first test in `electron/`. The rest of `components/` and `electron/`
    are untested and outside the coverage set; add tests with any risky change, and keep new lib code at 100%.

## How I work (file map)

- `electron/main.cjs`: shell; starts Next, windows, tray, dock, `weft://` links, global hotkey;
  `electron/startup-screen.cjs` runs the start screen and shows why the board didn't load (Retry, Logs, Quit);
  `electron/startup-timer.cjs` times every launch into `~/.weft/startup.jsonl` (`node electron/startup-timer.cjs` lists them).
- `electron/browser-pane.cjs`: native browser pane, one page per card; token-guarded control
  server on 127.0.0.1 for agents, IPC for the board (`electron/preload.cjs`); `electron/pane-pages.cjs`
  saves each card's page to `~/.weft/pages/` so it comes back after a restart.
- `electron/menus.cjs` + `electron/keep-working.cjs`: app menu, menu bar icon, dock; Keep Working (awake with the lid shut, until threads finish).
- `electron/updater.cjs` + `scripts/release-feed.mjs` + `.github/workflows/release.yml`: updates from GitHub Releases (Squirrel.Mac's JSON
  feed, a download fallback when unsigned) and the tag-triggered signed release; `CHANGELOG.md` holds each version's notes (docs/architecture/updates.md).
- `electron/terminal.cjs` + `components/TerminalDrawer.tsx`: the terminal drawer (node-pty shell over IPC, xterm.js).
- `lib/runner.ts`: one Agent SDK `query()` per thread, its public API (send, queue, stop, retry, login); behind it
  `lib/runner-state.ts` (sessions, shared maps, `hooks` back into runner.ts), `lib/runner-session.ts` (start and drive a CLI,
  warm spares, the BUILD fingerprint), `lib/runner-turn.ts` (what the CLI sends during a turn) and `lib/runner-ask.ts` (permissions);
  puku-cli via `pathToClaudeCodeExecutable` (`lib/cli-path.ts`). `editLastMessage()` is ↑ in the reply box: it rewinds the
  session to before your last message (`lib/edit-last.ts`, `lib/rewind.ts`) and sends the edit.
- `lib/env.ts` `guardedCli()`: every thread's CLI env and Bash guards: `lib/secret-guard.ts` (no .env reads),
  `lib/restart-guard.ts` (no restarting Weft mid-turns), `lib/git-guard.ts` (no `git stash`, `reset --hard`, path
  checkout/restore or `clean -f` in the shared tree) (docs/architecture/thread-guards.md).
- `lib/schedule.ts` + `lib/scheduler.ts` + `components/SendLater.tsx`: "Send later" replies; the server sends them at their
  time, by default the next 5-hour reset.
- `lib/status.ts` + `lib/settings.ts`: the BOARD STATUS protocol (thread prompt and its parser).
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
- `lib/card-pictures.ts`: a card's thumbnail (latest thread image, or a pane capture after each turn from `lib/glance.ts`) and its Haiku emoji tile; `lib/retitle.ts` renames a card with a placeholder title ("Image attachment") after its turn (`titleBy` marks a name Weft or you chose) and gives an untagged card 1 to 3 tags in the same Haiku call (`tagsBy`); `components/CardView.tsx` draws the card.
- `lib/tags.ts` + `lib/tag-store.ts` + `app/api/tags` + `lib/rail-view.ts` + `components/LibraryRail.tsx` (`SideRail`) + `components/TagsDrawer.tsx` +
  `components/TagsDialog.tsx` + `components/CardMarks.tsx` + `components/StarButton.tsx`: ★ star (never auto-archived; the rail's ★ filters
  the board) and tags (GitHub label rules, catalog in `~/.weft/tags.json`, the 🏷 drawer, pills on the card's stage line); they replaced the
  library (docs/architecture/tags.md).
- `lib/github-issues.ts` + `app/api/github/issues`: a project's open GitHub issues become Backlog cards through the `gh` CLI, labels as tags,
  one direction; opt-in folders in settings `issueFolders`, polled from `prewarm()` every 5 min (docs/architecture/github-issues.md).
- `lib/account.ts` + `app/api/account` + `lib/use-account.ts`: the optional Weft account (Supabase Auth, PKCE; the
  redirect target is `weft://account-callback` in the packaged app and the loopback HTTP origin in `next dev`,
  handled by `electron/account-link.cjs` and `app/api/account/weft-callback/route.ts`; sign-in / sign-out pages
  share `lib/account-page.ts`). Session in `~/.weft/account.json` (Keychain-sealed by `electron/account-store.cjs`),
  drawn by `components/AccountButton.tsx` (top bar) and `components/AccountSettings.tsx`; schema in
  `supabase/migrations/`, MCP server in `.mcp.json`.
- `electron/vault*.cjs` + `electron/dotenv.cjs` + `electron/device-key.cjs` + `components/VaultDrawer.tsx`: the 🔐 secrets vault
  (docs/architecture/secrets.md); decryption only in main, IPC to the board window only, `lib/vault-view.ts` + `lib/use-vault.ts` on the board side.
- `electron/vercel*.cjs` + `lib/vercel-view.ts` + `lib/use-vercel.ts` + `lib/use-linked-status.ts` (the three drawers' cached status hook) + `components/Vercel*.tsx`: the ▲ Vercel drawer (token sealed
  in the Keychain, link or create a project as `.vercel/project.json`, latest deploy; docs/architecture/vercel.md).
- `electron/supabase.cjs` + `lib/supabase-view.ts` + `lib/use-supabase.ts` + `components/Supabase*.tsx`: the Supabase drawer (its bolt
  on the rail; token sealed in the Keychain, link a project as `supabase/.temp/project-ref`, state, unapplied migrations; docs/architecture/supabase.md).
- `electron/blastcp*.cjs` + `lib/blastcp-view.ts` + `lib/use-blastcp.ts` + `components/BlastcpDrawer.tsx`: the BlastCP drawer (its rocket logo on the rail, `components/BlastcpLogo.tsx`) (OAuth + PKCE
  sign-in sealed in the Keychain, reads through BlastCP's MCP tools, folder → property links in `~/.weft/blastcp-links.json`; docs/architecture/blastcp.md).
- The board's native right-click menus (lib/card-menu.ts) are built and popped in `electron/main-menu-popup.cjs`:
  one IPC handler, a fresh `Menu` from the items the board sends, the click → resolve wiring behind a `setTimeout`
  (because click fires before the callback on macOS but not on every platform). `Menu` and `BrowserWindow` are
  injected so the test can pass mocks without a real Electron.
- `lib/copilot.ts` + `lib/board-tools.ts`: the copilot thread and its `mcp__board__*` tools.
- `lib/browser-tools.ts`: `mcp__browser__*` tools every thread gets.
- `lib/import.ts`, `lib/search.ts`: pick up `~/.claude/projects` sessions as cards; search index.
- `lib/hotkeys.ts` + `lib/shortcut-catalog.ts`: the keyboard shortcut registry and what the `?` sheet lists; tooltips, key badges,
  right-click menus and `ModifierHint` read their keys from it (docs/architecture/keyboard-shortcuts.md).
- `lib/new-thread.ts` + `components/submit-keys.ts` + `lib/use-mod-held.ts`: what the New thread dialog offers and remembers (CLIs, models,
  effort, drafts), and its start keys: ⌘↵ starts and closes, ⌃↵ starts and stays open, and holding either relabels Start.
- `lib/theme.ts` + `app/api/scenes` + `components/AppearancePicker.tsx` + `electron/theme-source.cjs`: System, Light, Dark or a scene
  (one of Weft's pictures behind the board with its own palette, in `app/globals.css`; docs/architecture/themes.md).
- `lib/store.ts`: storage in `~/.weft` (board.json, threads/, attachments/).
- `app/api/*` + `lib/guard.ts`: localhost-only Host check, writes need `x-threadboard: 1`.
- `lib/restart-guard.ts`: turns away Bash that would kill or restart Weft itself (its server pid, port, `next dev`, the app)
  while other cards' turns run, since a restart cuts them all off; in every thread via `guardedCli()`.
- `lib/import-check.ts`: after each Edit/Write, tells the thread which imports it broke (a build error no boundary catches);
  in every thread via `lib/env.ts` `guardedCli()`, and in other Claude Code sessions via `.claude/settings.json`.
- Components: `Board.tsx`, `ThreadView.tsx`, `ThreadItems.tsx`, `Markdown.tsx`, `ReviewPanel.tsx`;
  every dialog sits in `Modal.tsx` (backdrop, header, close, Escape via `lib/use-escape.ts`);
  each card, panel, dialog body, drawer, header badge and thread message sits in `CrashGuard.tsx` (an error boundary;
  `inline` draws a one-line chip for small spots), with `app/error.tsx` behind the whole board. Board's panels, dialogs,
  cards and badges, the reply box and the review panel load through `guarded()` (`components/guarded.tsx`, an `import()`
  inside a CrashGuard), so even a module that throws as it loads (JSX in a constant before its import) breaks only its spot.
  A build error (a file that doesn't parse) fails the route before React runs, so no boundary sees it: `components/BuildErrorBar.tsx`
  (`lib/build-error.ts`) hides Next's overlay and leaves the last version that built running.
- Deeper docs: docs/architecture/*.md.

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
- **When a command needs a value** (`npm run job` or a migration with `DATABASE_URL`, a CLI with an API token): call
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
- Run me in dev mode (`npm run desktop`, or the `~/Applications/Weft.app` launcher, which opens
  Electron on this folder). Run `npm run dist` only to ship a build to someone else; a local
  packaged `.app` goes stale with every commit.
- When a feature lands, update README.md and docs/ROADMAP.md in the same change, and add a line under Unreleased in CHANGELOG.md.
- Run `npm run lint`, `npm run typecheck` and `npm test` (Vitest; tests sit beside the code as `lib/*.test.ts` and `components/*.test.tsx`, the latter in jsdom with `// @vitest-environment jsdom` and `./test-utils`; API routes in `app/api/routes.test.ts`).
- Stage every new file a change imports. The pre-commit hook (`.githooks/pre-commit`, set up by
  `npm install`) type-checks the staged files alone and refuses a commit that imports an unstaged
  file. Never `git stash` in this tree: other threads' unstaged work lives here too.

## Known gaps (verified 2026-10-12)

- Coverage counts only `lib/` and `app/api/` (100% lines, 98.6% branches on 2026-10-11). `components/` has
  behavior tests for CardView, ReplyBox, NewCardDialog, TagsDialog, TagsDrawer and ThreadPanel only (not Board, ThreadView or the real TipTap Composer);
  `electron/` has one (`electron/main-menu-popup.test.ts`). Runner's leftover branches are defensive fallbacks.
  CI (`.github/workflows/ci.yml`) runs lint, typecheck and tests, but the repo has no upstream branch yet, so it hasn't run.
- `lib/account.ts` declares `WEEFT_PROTOCOL` on line 101 and uses it on line 96 (forward reference). `ACCOUNT_CALLBACK_HOST`
  is duplicated in `lib/account.ts:94` and `electron/account-link.cjs:6`; one should import from the other.
- `7b1db11`, `dfdd9c7` and `0e54c6f` don't build on their own (Board.tsx imported files committed later);
  everything from `2766738` on does.
- The overlap warning (`lib/overlap.ts`) counts a card's edits for its whole life, committed or not, and
  shows shared files only in the reply box: the card's "+N here" tooltip and the New thread dialog don't name them.
- The copilot learns what finished or needs you only with your next message (`lib/copilot-digest.ts`);
  it never runs a turn on its own.
- puku-cli sessions aren't imported; a full puku thread hasn't been verified end to end.
