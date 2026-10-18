# Limits chart

Hovering the status strip's `5hr` / `7d` opens a chart of the week, from one weekly reset to the next.
One plot, two axes:

- **Left axis, green:** the 5-hour limit left, as 168 equal hour bars. Each reads the level at the end of
  its hour (or now). An hour inside a 5-hour window that has opened with nothing logged is hatched.
- **Right axis, red:** the weekly limit left, as 7 equal day bars drawn in front of the green at 45% so
  the hours show through. Each bar's top is its burn-down edge, the weekly level hour by hour through
  the day, drawn thick, with the day's end % on top. Days before the first reading say "no log yet".
- **Vertical lines:** red where a window ran out (its first reading at 100% used); green at each 5-hour
  reset (light: the past ones the log saw, then every 5 hours after the next one), the next 5-hour reset
  (strong) and the weekly reset (strongest, the right edge). A dotted line marks now.

## Key files

- `lib/limit-history.ts`: `recordLimits(backend, patch)` appends a `LimitSample` (`at` ms, `backend`,
  `kind` `five_hour` | `seven_day`, `used` 0-100, `resetsAt` unix seconds rounded to the minute) to
  `~/.weft/limits.jsonl` when a window's share or reset changes for that CLI. The CLI reports one reset a
  few hundred ms apart from call to call, so resets are compared to the minute. `readSamples()` returns
  the last 8 days oldest first, skips bad lines, and drops older lines from the file once per process.
  Never throws.
- `lib/runner-turn.ts`: `updateLimits()` is the one place a thread's windows change (a rate-limit event,
  or the CLI's usage report at `init` and, through `refreshLimitsAfterTurn()`, after each turn at most
  every `LIMITS_EVERY_MS` = 5 minutes per thread); it updates the card's stats and records the sample.
- `lib/limit-chart.ts`: pure chart math, `limitsChart(samples, stats, now)` → `{ start, end, now, hours,
  days, marks }`. `leftAt()` is the level at a time: the last reading while its window is open, full once
  it has reset, `"unknown"` before the first reading or inside a window that opened unlogged; `null`
  marks a slot that hasn't happened yet. The card's current windows are added at now unless they've
  already reset or are older than the history (a card's stats can be hours old).
- `app/api/limits/route.ts`: `GET /api/limits?backend=claude|puku` returns that CLI's samples.
- `components/LimitBurndown.tsx`: the 640 px SVG (`CHART_WIDTH`), in a 664 px `Tip` over the strip's
  `Limit` chips in `components/StatusStrip.tsx`. Colors are the theme's `--ok` and `--danger`.

## Data flow

CLI event or turn end → `updateLimits` → card `stats.fiveHour` / `sevenDay` (latest only) and a sample in
the log → hover → `GET /api/limits` → `limitsChart()` adds the card's current reading → SVG.

## Notes

- The history started 2026-10-17 and has a gap from 01:24 to 20:10 on 2026-10-18, while the logging
  call was missing from the runner.
- Limit hits come from these samples, not from transcripts. `lib/usage.ts` also detects hits from
  transcripts for the Loom's usage chart; the two aren't unified yet.
- Samples are per CLI (`backend`), matching the strip, which shows the open card's own CLI.
