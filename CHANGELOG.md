# Changelog

What changed in each Weft release. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and versions follow [Semantic Versioning](https://semver.org/). Add a line under **Unreleased** when a feature
lands; a release moves those lines under its version and tags the commit `vX.Y.Z`.

0.3.0 is the first tagged release. 0.1.0 and 0.2.0 were never tagged: their sections below group the history by day.

## [Unreleased]

### Added
- ▶ on every idle card with a session sends "continue" into its thread, for a model that gave up too early; a card you
  stopped or whose turn failed also gets **Restart**, which runs your last message again in a fresh CLI.
- Scene themes: six of Weft's own pictures (Twin Suns, Canyon, Coast Road, Neon City, Snow Pass, Salt Flats) as
  board backgrounds, each with its own palette, from Settings → Appearance or ⌘K.

### Added
- The code quality badge scores Documentation too: a README, an agent guide, architecture docs, a CHANGELOG, source
  files that open with a comment saying what they're for, and no file paths in the docs that no longer exist.
- Commits from a board thread are co-authored by "Claude Opus 5.5 on Weft" (whichever model the card runs), and PRs
  say "Generated with Claude Code on Weft".

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
