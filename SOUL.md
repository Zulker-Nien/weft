# SOUL.md: who I am

I am Weft, a desktop kanban board where every card is a Claude Code or puku-cli thread, with a
browser pane beside the board and a copilot window that runs the board. The weft is the thread
that crosses the loom and binds separate threads into cloth; I bind your agent threads into work.

I am built for builders and product managers: the ultimate creation tool. You bring the idea; I run
the threads that plan it, build it, show it in the browser pane and walk you through the review.

If you are an agent editing this repo, you are working on me. Read README.md for features.

## What I value

- **Speed first.** CLIs are warm and pre-started (spares, keep-alive), so a reply starts in ~2s.
  Never add work to the start-a-card path without measuring it.
- **No git worktree per card, on purpose.** Worktrees cost a fresh checkout, `npm install` and env
  setup per card, and leave stray folders behind (like `fervent-tu-abd214`). I prefer cheap safety:
  busy-folder and overlap warnings. (docs/ROADMAP.md still lists worktrees as P1; my stance wins.)
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
  - hotspots: components/Board.tsx (~950 lines), lib/runner.ts (~800), electron/main.cjs (~620).
    Pure logic already moved out: `lib/board-view.ts` (columns, project chips, chime/unseen rules) and
    `lib/turn.ts` (how a turn's result reads, cost, limits). Next: Board's state into hooks.
  - I have a small Vitest suite (`npm test`) over the pure logic in `lib/` and the API routes
    (`app/api/routes.test.ts`, runner and store mocked), plus characterization tests of the runner's
    SDK loop (`lib/runner.test.ts`, fake `query()`). The UI is still untested; add tests with any risky change.

## How I work (file map)

- `electron/main.cjs`: shell; starts Next, windows, tray, dock, `weft://` links, global hotkey.
- `electron/browser-pane.cjs`: native browser pane, one page per card; token-guarded control
  server on 127.0.0.1 for agents, IPC for the board (`electron/preload.cjs`).
- `lib/runner.ts`: one Agent SDK `query()` per thread, warm spares, permissions, turn queue;
  puku-cli via `pathToClaudeCodeExecutable`.
- `lib/status.ts` + `lib/settings.ts`: the BOARD STATUS protocol (thread prompt and its parser).
- `lib/review.ts`, `lib/devserver.ts`: `weft-review` tour blocks and the card's dev server.
- `plugin/skills/*`: my own skills (`/weft:done`, `/weft:commit`, `/weft:preview`, `/weft:setup-done`,
  which installs tests, docs and strict lint on a project before `/done`; `/weft:done` also keeps this file current);
  `lib/skills.ts` lists skills, `lib/automations.ts` turns "When … run …" rules into turns.
- `lib/coverage.ts` + `app/api/coverage`: read `coverage/coverage-summary.json` (`npm run coverage`) for the
  header pie, `components/CoverageBadge.tsx`.
- `lib/copilot.ts` + `lib/board-tools.ts`: the copilot thread and its `mcp__board__*` tools.
- `lib/browser-tools.ts`: `mcp__browser__*` tools every thread gets.
- `lib/import.ts`, `lib/search.ts`: pick up `~/.claude/projects` sessions as cards; search index.
- `lib/store.ts`: storage in `~/.weft` (board.json, threads/, attachments/).
- `app/api/*` + `lib/guard.ts`: localhost-only Host check, writes need `x-threadboard: 1`.
- Components: `Board.tsx`, `ThreadView.tsx`, `ThreadItems.tsx`, `Markdown.tsx`, `ReviewPanel.tsx`;
  every dialog sits in `Modal.tsx` (backdrop, header, close, Escape via `lib/use-escape.ts`).
- Deeper docs: docs/architecture/*.md.

## Conventions to keep

- End every board-thread reply with the BOARD STATUS line the thread prompt asks for; don't change
  its format without updating `lib/status.ts`.
- This Next.js differs from your training data: read `node_modules/next/dist/docs/` first.
  Leave the managed block in AGENTS.md alone.
- When a feature lands, update README.md and docs/ROADMAP.md in the same change.
- Run `npm run lint`, `npm run typecheck` and `npm test` (Vitest; tests sit beside the code as `lib/*.test.ts`, API routes in `app/api/routes.test.ts`).
- Stage every new file a change imports. The pre-commit hook (`.githooks/pre-commit`, set up by
  `npm install`) type-checks the staged files alone and refuses a commit that imports an unstaged
  file. Never `git stash` in this tree: other threads' unstaged work lives here too.

## Known gaps (verified 2026-10-10)

- Tests cover `lib/status.ts`, `review.ts`, `guard.ts`, `automations.ts`, `format.ts`, `settings.ts`, `store.ts`,
  `board-tools.ts`, `board-view.ts` and `turn.ts`, plus the state-changing API routes (`app/api/routes.test.ts`;
  events, search, transcribe, attachments and repos GET aren't covered); `lib/runner.test.ts` pins runner.ts's SDK loop with a fake `query()`; none for the UI. CI (`.github/workflows/ci.yml`) runs lint,
  typecheck and tests, but the repo has no upstream branch yet, so it hasn't run.
- `7b1db11`, `dfdd9c7` and `0e54c6f` don't build on their own (Board.tsx imported files committed later);
  everything from `2766738` on does.
- Busy-folder warning exists (`lib/overlap.ts`: "+N here" on the card, "Also running here" in the reply box),
  but no file-overlap check: tool items keep only a clipped `summary`, and other cards' threads aren't loaded.
- The copilot learns what finished or needs you only with your next message (`lib/copilot-digest.ts`);
  it never runs a turn on its own.
- puku-cli sessions aren't imported; a full puku thread hasn't been verified end to end.
