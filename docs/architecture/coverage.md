# Test coverage badge

## Overview

The header shows test coverage for the project in view ("49% coverage", with a pie). Hovering it
opens a breakdown. A project with no report gets a **Set up coverage** button instead, which starts
a card to add one.

## Key files

- `lib/coverage.ts`: `readCoverage(root)` parses `coverage/coverage-summary.json` (the json-summary
  reporter's output); `findCoverage(cwd)` walks up from a folder to its git root and returns the nearest
  report with its `root` and `measuredAt` (the file's mtime).
- `app/api/coverage/route.ts`: `GET /api/coverage?cwd=…` returns `{ coverage: CoverageReport | null }`.
- `components/CoverageBadge.tsx`: the badge, its breakdown bubble, and the setup button.
- `components/Tip.tsx`: the hover bubble (a portal, kept inside the window). Native `title` tooltips
  don't show in Electron, so every hover hint in the header and footer uses this.
- `components/Board.tsx`: passes the folder and `onSetup`; `setupCoverage` creates the card from
  `COVERAGE_SETUP_PROMPT`.

## Data flow

1. Board picks the folder in view: the open card's `cwd`, else the selected project, else the latest card's.
2. The badge fetches `/api/coverage` for that folder, and again whenever the window regains focus,
   so a fresh `npm run coverage` shows up without a reload. Results are keyed by folder, so switching
   projects never shows the previous project's numbers.
3. Report found: pie and percent (lines), toned green at 80%+, warn at 50%+, danger below. No report:
   the dashed **Set up coverage** button.
4. Clicking it creates a started card ("Set up test coverage") in that folder that runs
   `/weft:setup-done` and then `npm run coverage`. The button reads "Setting up coverage…" and is
   disabled for that folder for the rest of the session, so one click can't start two cards.

## Important patterns

- The lookup stops at the first folder containing `.git`, so a report in a parent of the repo is never used.
- `NewCardInput.permissionMode` is optional; the server falls back to the default mode from settings.
- The badge renders nothing until the first response for the current folder arrives, which avoids a
  flash of the "Set up coverage" button.
