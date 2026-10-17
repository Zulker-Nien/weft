# Limits burndown

Hovering the status strip's `5hr` / `7d` opens a chart of the week: the weekly limit left in red, the
5-hour one in green, red lines where either ran out, and green lines at the resets (light at each 5-hour
reset, strong at the next one, strongest at the weekly reset). A dotted line shows an even burn from full
at the week's start to empty at its reset.

## Key files

- `lib/limit-history.ts`: `recordLimits(backend, patch)` appends a `LimitSample` (`at` ms, `backend`,
  `kind` `five_hour` | `seven_day`, `used` 0-100, `resetsAt` unix seconds) to `~/.weft/limits.jsonl` each time a
  window's share or reset changes for that CLI. `readSamples()` returns the last 8 days oldest first, skips
  bad lines, and drops older lines from the file once per process. Never throws: a failed write loses a
  sample, not a turn.
- `lib/runner-turn.ts` `updateLimits()`: the one place a thread's windows change (a rate-limit event or the
  CLI's usage report); it updates the card's stats and records the sample.
- `lib/limit-chart.ts`: pure chart math, `burndown(samples, stats, now)`. Spans the week ending at the known
  weekly reset (the card's, else the last sample's, rolled on a week at a time), or the last two days when none
  is known. The 5-hour line (`fiveHourLine`) goes back to full at each reset and stays flat until the next
  window opens; `hitMarks` marks a window's first reading at 100%; `resetMarks` draws the green lines.
- `app/api/limits/route.ts`: `GET /api/limits?backend=claude|puku` returns that CLI's samples.
- `components/LimitBurndown.tsx`: the SVG chart, in a wide `Tip` (`width` prop) over the strip's `Limit`
  chips in `components/StatusStrip.tsx`. Colors are the theme's `--ok` and `--danger`.

## Data flow

CLI event → `updateLimits` → card `stats.fiveHour` / `sevenDay` (latest only) and a sample in the log →
hover → `GET /api/limits` → `burndown()` adds the card's current reading → SVG.

## Notes

- A card only keeps its latest window, so the history starts on the day this shipped; before the first
  sample the weekly line is drawn faint from 100% at the week's start.
- Limit hits come from these samples (a reading at 100% used), not from transcripts. `lib/usage.ts` also
  detects hits from transcripts for the Loom's usage chart; the two aren't unified yet.
- Samples are per CLI (`backend`), matching the strip, which shows the open card's own CLI.
