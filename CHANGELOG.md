# Changelog

What changed in each Weft release. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and versions follow [Semantic Versioning](https://semver.org/). Add a line under **Unreleased** when a feature
lands; a release moves those lines under its version and tags the commit `vX.Y.Z`.

0.3.0 is the first tagged release. 0.1.0 and 0.2.0 were never tagged: their sections below group the history by day.

## [Unreleased]

### Added
- Shift+`S` adds a secret: it opens the 🔐 drawer on its Add form, and "Add a secret" in the ⌘K palette and the `?` sheet does the same.
- Threads can run a command with 🔐 vault secrets they never see: `mcp__secrets__run` asks you (the exact command, its
  `package.json` script, the names; Allow once or Always allow, then Touch ID), runs it from Electron main with the
  values in its env only, and returns the exit code and output with each value as `‹NAME›`. A card's dev server gets
  the vault's development values the same way, and a secrets-using card's stored tool results are redacted.
- ▲ on the left rail links a project to Vercel: paste a token once (kept in the Keychain), pick one of your Vercel
  projects or make a new one with its GitHub repo connected, and see its production URL and latest deploy. The link is
  `.vercel/project.json`, so the Vercel CLI in threads works on the right project.
- A linked Vercel project's card links straight to the latest deploy's page, runtime logs, env vars, domains and the
  dashboard; personal projects (no team) now link to their own dashboard too.
- The code quality badge scores Documentation too: a README, an agent guide, architecture docs, a CHANGELOG, source
  files that open with a comment saying what they're for, and no file paths in the docs that no longer exist.
- The copilot shows as a card at the top of its column (✨ whole board), so you can see when it's running or needs you;
  click it to open the copilot window, or Allow, Deny and Stop right on the card.
- The New thread page cycles through the speeder and the five backdrop scenes, a new one each time you open it.
- Placeholder cards pulse in every column while the board loads, instead of empty columns and "0" counts.
- ▶ on every idle card with a session sends "continue" into its thread, for a model that gave up too early; a card you
  stopped or whose turn failed also gets **Restart**, which runs your last message again in a fresh CLI.
- **▶ Resume N** at the top of Review carries on every turn there that a restart cut off or that failed. A turn cut off
  again during its carry-on now resumes again too, up to three times in a row (it used to stay stopped after one).
- BlastCP on the left rail, under its rocket logo: connect your BlastCP account in the browser (kept in the Keychain), link each project to
  the property it posts as, and see its next scheduled posts, drafts, posts to approve and failures; click one to
  open it in the browser pane.
- Many more error boundaries: one message, dialog, drawer or header badge that fails to draw shows a "failed to draw ·
  Try again" in its own spot (a small chip for badges and messages), and the reply box, dialog ✕ and the rest stay working.
  The board's panels, dialogs, cards and badges load in their own boundary too, so a file a thread left half-written
  (even one that fails as it loads) no longer blanks the whole board; a broken dialog offers Close, and the board's
  own error page hides the browser pane so it isn't covered.
- An archive button in the Done column header files away every Done card it shows (same as Shift+E), with Undo.
- Threads fill secrets in themselves: `mcp__secrets__list` gives a vault's names and `mcp__secrets__fill_field` types a
  value into a field in the browser pane after your Touch ID (naming the secret, vault and site), masked on screen and
  shown to the thread as `‹NAME›`. The thread never sees the value; https pages only.
- Scene themes: six of Weft's own pictures (Twin Suns, Canyon, Coast Road, Neon City, Snow Pass, Salt Flats) as
  board backgrounds, each with its own palette, from Settings → Appearance or ⌘K.
- Plan first: on a long task, a thread writes its plan to the browser pane in one of its first tool calls and ticks
  the steps off as it builds, so you can watch the plan instead of a blank pane.
- Resume after restart: a card that was running when Weft quit carries its turn on after the restart, instead of
  sitting in Review as "Stopped when the app closed".
- Board skeleton: while the card list loads on launch, each column shows pulsing placeholder cards instead of
  sitting empty with "0" counts.
- Commit walk-through: Commit, Commit and push and Commit and run /done run on their own with no LLM turn
  (`weft://commit`): they commit exactly the change's files, push, move its card to Done and stamp the page;
  only a failure (say, the pre-commit hook refusing) asks the thread for help.
- Weft account: Sign in with GitHub from the top bar (right of Copilot), or with GitHub, Google or an email link in
  Settings → Weft account, against the Weft prod Supabase project. Signed in, the button is your avatar.
- Import guard: after each Edit or Write, a board thread (and its subagents) hears about any import the edit broke,
  so a half-finished change can't leave the board on a build error.
- New thread: ⌃↵ starts the thread and keeps the dialog open for the next one; holding ⌘ or ⌃ relabels the Start button.
- New project… in the New thread folder picker: name a folder, Enter creates it in ~/dev and starts the thread there.
- ⌘K opens on "Recently changed": the cards that moved column in the last day, latest first.
- ⌘K is wider with larger text, and each card row shows its last line of output (or its error) and how long ago it changed.
- Auto-updates: the packaged app checks GitHub Releases, downloads in the background and offers Restart to Update;
  Weft → Check for Updates… checks now. An unsigned build offers the download instead.
- Secrets vault: 🔐 on the library rail keeps each project's secrets encrypted on this Mac, imports `.env` files
  with a preview, nudges when `.env.local` has values to import, and asks for Touch ID to reveal or copy one.
- ⇧S (or "Add a secret" in ⌘K) opens the 🔐 drawer with its Add form ready on the top bar's project.
- Vault: add or change a secret by hand in any project, even one with no `.env` file; copy a secret to another
  project from its right-click menu; and a project filter that follows the top bar until you pick another.
- Releases: a `vX.Y.Z` tag builds, signs, notarizes and publishes the dmg and zip, with this changelog as the notes.
- Commits from a board thread are co-authored by "Claude Opus 5.5 on Weft" (whichever model the card runs), and PRs
  say "Generated with Claude Code on Weft".

### Changed
- A card running `/done` or `/weft:done` (typed, or from a move to Done) sits in Done while it runs, still
  spinning, and is archived when it finishes; before, it jumped back to Running until the end.
- Builder card: Craft now counts the habits your shipped cards' transcripts show: wrapping up with `/done`,
  committing, code review, docs and refactor skills, as well as refactor titles.

### Removed
- Builder card: the Thrift attribute (cost per shipped card) is gone; seven attributes remain.

### Fixed
- A thread can't restart Weft while other cards' turns run: a hook (`lib/restart-guard.ts`) turns away `kill`, `pkill`,
  `killall` or port-freeing aimed at Weft's own server, app or port, and a second `npm run dev` / `electron .` in
  Weft's folder, saying how many turns it would cut off. Alone on the board it's allowed; your project's dev server always is.
- A card whose CLI goes on working after its turn ended shows Running again, so a restart then finds it cut off instead
  of leaving it in Review with a tool call and no reply.
- Weft opens on the project you had selected last, with its sort order. They were kept per port, so a launch
  that started the server on another port forgot them (`lib/view-prefs.ts`).
- The board no longer fails to build when a card menu loses the library's star menu: ☆ stars or unstars a card in one
  click, and right-click Star/Unstar and Tags… work (a tag editor until the tag pills land).
- A thread's big heredoc no longer stalls the board's server in the secret guard: a 1.2 MB script with a few `{a, b}`
  groups took 300+ s (256 copies of itself, every token path-checked) and now takes ~0.2 s (`lib/secret-guard.ts`).
- The secret guard no longer stops a thread editing code that mentions `.env`: a `sed -e` script or a Python or
  Node edit whose text names `.env.local` runs; code that opens a `.env` file is still turned away (`lib/secret-guard.ts`).
- The usage strip shows reset times to the minute ("reset 11:06pm"), not rounded to the hour.
- A review tour arriving while you type no longer strands your message: it moves into the step's feedback box, focused.

## [0.3.0] - 2026-10-11

### Added
- Card library: star a card (☆ on cards and thread headers) to keep it as a recipe (a Claude skill), a to-do or a note;
  filing a card as a to-do takes it off the board.
- Archive with undo, picture cards (the latest thread image or a pane capture) and Haiku emoji tiles.
- Cards with a placeholder title get a Haiku title and emoji after their turn.
- Header code quality badge with a checklist (coverage, file size, lint, types, guardrails) and a refactor scout that
  starts a card per finding.
- Commit pile: the header's "+N/-N" uncommitted counter and a card that commits it one Review card at a time.
- Progress: streaks, XP, badges and a builder card.
- Startup screen shows why the board didn't load (Retry, Logs, Quit) instead of a stuck splash or blank window.
- Filter: the / key is always shown, matching cards drop down, and the search hands off to the command palette.
- Double-click empty board space to open New thread.
- Send later offers the weekly reset; Tab in the reply box takes the suggested next message.
- Composer drafts and tooltips, browser pane zoom, crash guards around every card and panel.
- The steel weave emblem is the app icon.
- `/weft:done` runs with three agents and the refactor scout.
- Component tests for CardView, ReplyBox and NewCardDialog; tests now cover every line of `lib/` and `app/api/`.

### Changed
- Dollar costs are gone from the board.

### Fixed
- Archived cards no longer count as needing you or running.
- Escape closes the open thread even mid-reply, and dialogs close before board panels.
- Only http(s) URLs can count as Weft itself in the browser pane.
- Long question lists scroll inside the thread panel.
- The commit walk-through says commit, push and /done instead of save.

## [0.2.0] - 2026-10-10

### Added
- Board tools (`mcp__board__*`) in every thread, prompt automations, effort levels, themes and chimes.
- Threads always show something in the browser pane; the glance page fills in when a turn showed nothing.
- Busy-folder and overlapping-edit warnings on cards, the reply box and the New thread dialog.
- The copilot hears what finished or needs you since its last message.
- Terminal drawer: a real shell per folder, with splits.
- Searchable shortcuts sheet, key hints and a hold-a-modifier cheat card.
- Command palette shows each result's project and status; searches the current project, Tab for all.
- The browser pane restores each card's last page after a restart.
- Send later: a clock beside Send that holds a reply until a set time.
- Native right-click menus for cards and columns; rename a card from its open thread.
- Default permission mode (Auto) and an effort setting that follows the last card.
- `/weft:setup-done`, a tighter `/weft:done`, and typing /done archives the card when its turn ends.
- Open-source repo files (license, contributing, security, issue and PR templates, CI) and a Vitest suite.

### Changed
- Cards always open full screen; the side-panel mode is gone.
- Review steps are pages, and the review feedback box uses the shared composer.

### Fixed
- Escape in the browser pane closes the board's newest layer; every dialog shares one Modal.
- The dev server evicts stale listeners and clears a stale Turbopack cache.
- Status lines quoted in code fences are skipped.
- A card that adopts a warm spare gets its session id at once.

## [0.1.0] - 2026-10-09

### Added
- Weft: a desktop kanban board where every card is a Claude Code thread, with a browser pane beside the board.
- Prompts with inline screenshots, video, dictation and a repo picker; skill typeahead on `/`.
- Board skills and automations; review tour, per-card browser, dev server start and the preview skill.
- Command palette search over your prompts; keyboard shortcut registry and a `?` sheet.
- Status strip with plan quota, project and branch; choose the Claude model per thread.
- About window with version, server port and PIDs; the start screen.

[Unreleased]: https://github.com/aimhuge/weft/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/aimhuge/weft/releases/tag/v0.3.0
