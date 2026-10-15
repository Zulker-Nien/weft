# Contributing to Weft

Thanks for helping. Weft is a desktop kanban board where each card is a Claude Code or puku-cli
thread. Read [SOUL.md](SOUL.md) first: it says what Weft values and where things live.

## Setup

```bash
git clone https://github.com/aimhuge/weft.git
cd weft
pnpm install
pnpm desktop        # Electron app: board + side browser
pnpm dev            # board only, at http://127.0.0.1:1024
```

You need Node 20+ and a logged-in `claude` CLI (or `puku-cli`). Weft is macOS-first today.

## Before you open a PR

```bash
pnpm lint
pnpm typecheck
pnpm test
```

`pnpm install` sets up a pre-commit hook that type-checks exactly what you staged, so a commit can't
import a file you forgot to `git add`.

Tests are Vitest and sit beside the code as `lib/*.test.ts`. Add a test with any risky change,
especially to `lib/`. The runner, store and UI are still untested, so tests there are welcome.

## Guidelines

- **Keep PRs small and focused.** Refactor in separate, behavior-preserving steps, with tests first.
- **Speed matters.** Don't add work to the start-a-card path without measuring it.
- **Screen space is precious.** Fold new UI into existing controls (menus, counts, badges) rather
  than adding rows or chips.
- **This Next.js differs from older versions.** Read `node_modules/next/dist/docs/` before changing
  routing or data fetching. Leave the managed block in `AGENTS.md` alone.
- **Update docs with the feature.** Change README.md and docs/ROADMAP.md in the same PR.
- **Conventional commits** (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`).
- If you change the BOARD STATUS line format, update `lib/status.ts` and its tests too.

## Reporting bugs and ideas

Open an issue using the templates. For security problems, see [SECURITY.md](SECURITY.md) instead.

By contributing you agree your work is released under the [Apache License 2.0](LICENSE).
