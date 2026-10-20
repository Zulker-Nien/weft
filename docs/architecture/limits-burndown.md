# Limits chart

Hovering the status strip's `5hr` / `7d` opens a chart of the week, from one weekly reset to the next.
One plot, two axes:

- **Left axis, green:** the 5-hour limit left, as 672 equal 15-minute bars (4 per hour). Each reads the
  level at the end of its slot (or now). A slot inside a 5-hour window that has opened with nothing
  logged is hatched.
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
- `lib/limit-poll.ts`: `startLimitPoll()` runs in the background every `LIMITS_POLL_MS` = 15 minutes. It
  reuses a warm spare (or opens a one-off session the first time) for the user's default CLI in their
  most-recent project folder, asks it for its 5-hour and weekly usage, and pipes the result through
  `recordLimits`. The CLI's `usage_EXPERIMENTAL_*` is a local in-process read of its bookkeeping — no
  network, no tokens — so the cost is one process startup on the first poll if no spare is open yet
  and zero once one is. Codex cards skip it (no equivalent yet); they still get samples from thread
  turns. Booted from `lib/game-server.ts:gameState()` and `app/api/events/route.ts` next to the
  activity log.
- `lib/runner-turn.ts`: `updateLimits()` is the per-thread writer (a rate-limit event, or the CLI's
  usage report at `init` and, through `refreshLimitsAfterTurn()`, after each turn at most every
  `LIMITS_EVERY_MS` = 5 minutes per thread); it updates the card's stats and records the sample.
- `lib/limit-history.ts` `setOnLimitReset(handler)` and the `used >= 100 → used < 100` check inside
  `recordLimits` notify one subscriber when a window just reset. `lib/limit-resume.ts`
  `resumeParkedCards(backend, kind, now)` is the subscriber, installed by `lib/limit-poll.ts` on
  first import: for every non-archived, `needs_you`, `rateLimitHit` card on that backend, it
  clears the rate-limit flag, stamps `autoResumedAt`, sets
  `lastLine = "Auto-resumed after 5-hour reset"` (or `weekly`), and replays the last user message
  the same way `lib/backend-switch.ts` does for a `rateLimitHit` card. The card's `CardMarks`
  shows an "Auto-resumed · 4:12am" chip with a tip that names the CLI. A busy card is skipped;
  the next poll cycle picks it up. The manual "Run on …" still works as an override when the
  user prefers to switch backends first.
- `lib/limit-chart.ts`: pure chart math, `limitsChart(samples, stats, now)` → `{ start, end, now, hours,
  days, marks }`. `hours` are 672 15-minute slots of the 5-hour limit (`QUARTER_HOUR`); `days` are 7
  day slots of the weekly limit with hour-resolution burn-down edges. `leftAt()` is the level at a time:
  the last reading while its window is open, full once it has reset, `"unknown"` before the first
  reading or inside a window that opened unlogged; `null` marks a slot that hasn't happened yet. The
  card's current windows are added at now unless they've already reset or are older than the history.
- `app/api/limits/route.ts`: `GET /api/limits?backend=claude|puku` returns that CLI's samples.
- `components/LimitBurndown.tsx`: the 640 px SVG (`CHART_WIDTH`), in a 664 px `Tip` over the strip's
  `Limit` chips in `components/StatusStrip.tsx`. Colors are the theme's `--ok` and `--danger`.

## Data flow

CLI event or turn end → `updateLimits` → card `stats.fiveHour` / `sevenDay` (latest only) and a sample in
the log. Background tick → `startLimitPoll` → spare or one-off `usage_EXPERIMENTAL_*` →
`recordLimits` → a sample. Hover → `GET /api/limits` → `limitsChart()` adds the card's current reading →
SVG.

## Notes

- The 15-minute slot size trades off bar width (~0.9 px each on a 640 px chart) for finer time
  resolution: a window that opened and closed while no thread was running (a few hours of "no log yet"
  stretches) now fills in continuously.
- Limit hits come from these samples, not from transcripts. `lib/usage.ts` also detects hits from
  transcripts for the Loom's usage chart; the two aren't unified yet.
- Samples are per CLI (`backend`), matching the strip, which shows the open card's own CLI.

