# Progress: streaks, XP, badges and the builder card

The header's 🔥 chip and its "Your loom" dialog turn your work in Weft into a streak, a level, badges,
a builder card and each project's production-ready tree. It's built so leagues can arrive with accounts
without a rewrite.

## Data flow

```
board card events (lib/bus.ts)
  └─ lib/activity.ts trackActivity()  ── appends ──>  ~/.weft/activity.jsonl
                                                         │
GET /api/game?cwd=&full=1 ── lib/game-server.ts gameState()
                                ├─ lib/game.ts            XP, levels, days, streak, cloth, records (pure)
                                ├─ lib/game-attributes.ts attributes, class, stack skills (pure)
                                ├─ lib/game-badges.ts     badges, fixes, toasts (pure)
                                └─ lib/project-checks.ts  measures repos → lib/project-badges.ts tree (pure)
components/HeaderBadges.tsx → GameBadge.tsx (chip, toasts) → LoomDialog.tsx (+ LoomBadges, LoomCharts)
```

## The activity log

`~/.weft/activity.jsonl` holds one JSON event per line: `created`, `start` (with how many cards run at once),
`turn` (with how many turns), `done` (with the card's cost and title) and `quality` (a project's daily
checklist score and coverage). Every event has a stable id, so a sync can tell what it already sent.

- **Backfill.** The first read writes events for every card on the board (`backfillEvents`): created at
  `createdAt`, its turns at its last activity, Done at `updatedAt`. Imported Claude Code sessions count.
  Backfilled ids are `created:<card>`, `turns:<card>`, `done:<card>`, so re-running is a no-op; on each
  server start, cards the log has never seen (no `created:<card>`) are backfilled the same way.
- **Live.** `trackActivity()` subscribes to the bus once per server process. `/api/events` (which the board
  opens first) and `/api/game` both call it. It remembers each card's column and turn count and logs what
  changed (`changeEvents`). The copilot is left out.
- Backfilled Done times are approximate (a card's last change), so "fastest ship" only times live Done events.

## Rules

- **XP**: created 2, turn 1, Done 10, or 15 when the project's latest quality snapshot before it scored 80+.
- **Levels**: level n starts at 40·(n−1)² XP. Titles at 1, 5, 10, 15, 20, 30: Thread, Strand, Yarn, Bolt, Loom, Tapestry.
- **Streak**: a day counts with any created, turn or Done event (local time). Each 7th day in a row earns a
  freeze (max 2); a missed day spends one. An empty today doesn't break it, it marks it at risk.
- **Attributes** (0–100): follow-through = Done ÷ started; velocity = 10 × shipped per active day (30 days);
  range = 6 per project with 3+ cards + 3 per technology; rigor = testing checks passed; guard = security and
  observability checks passed; craft = 4 × refactor share of shipped cards; stamina = active days of 30 × 80 +
  best streak (max 20); thrift = cost per shipped card on a log scale, $0.10 → 100, $5 → 0.
- **Class**: the top attribute's noun after the second's adjective ("Roaming Shipper").

## Projects

The light request (`/api/game`, the chip) never measures; it uses cached reports. The dialog's
`&full=1` measures the project in view plus your 6 busiest repos of the last 30 days (`rootsToMeasure`),
each cached for 10 minutes. Measuring runs `measureQuality` (lib/quality.ts) plus file, `package.json`
and git lookups, about 3s for 7 repos the first time. Each measured project logs one `quality` snapshot a day,
which drives the quality XP bonus and the coverage-climber badge.

`lib/project-badges.ts` lists every check with what counts and the prompt its **Set it up** card gets.
To add one: add it to `CHECKS`, detect it in `lib/project-checks.ts`, and test both.

## Toasts and quiet mode

The chip keeps the badges and level it has announced in `localStorage` (`weft-game-announced`). The first
load announces nothing, so history doesn't arrive as a burst. Settings > Show progress (`weft-show-progress`
cookie) hides the chip and its toasts.

## Leagues (next)

Leagues need accounts. The plan: sync weekly XP totals (from `weekXp`, Monday to Sunday) and a display name,
never prompts or code; the server ranks leagues of ~30, top 7 up, bottom 5 down, Cotton to Gold Thread.
