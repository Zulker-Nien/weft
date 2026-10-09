# File sizes

Lines per source file (app, lib, components, electron, scripts, docs, and the config files).
Snapshot: 2026-10-10

| Lines | Files |
|---|---|
| <=50 | 5 |
| 51-150 | 5 |
| 151-300 | 3 |
| 301-500 | 0 |
| 501-1000 | 0 |
| 1001-2000 | 0 |
| 2000+ | 0 |

Total files: 13. Over 500 lines: 0.

## Largest files

| Lines | File |
|---|---|
| 285 | docs/ROADMAP.md |
| 259 | docs/architecture/desktop-shell.md |
| 225 | docs/architecture/threads.md |
| 218 | docs/architecture/board.md |
| 213 | docs/architecture/import.md |
| 190 | docs/architecture/copilot.md |
| 160 | docs/architecture/browser-pane.md |
| 153 | README.md |
| 152 | docs/architecture/skills.md |
| 137 | docs/architecture/runner.md |
| 104 | docs/architecture/permissions.md |
| 88 | docs/architecture/index.md |
| 48 | docs/file-sizes.md |

## Delta from 2026-10-09

| Bucket | 2026-10-09 | 2026-10-10 | Change |
|---|---|---|---|
| <=50 | 28 | 5 | -23 |
| 51-150 | 17 | 5 | -12 |
| 151-300 | 10 | 3 | -7 |
| 301-500 | 3 | 0 | -3 |
| 501-1000 | 3 | 0 | -3 |
| 1001-2000 | 0 | 0 | 0 |
| 2000+ | 0 | 0 | 0 |
| **Total** | **61** | **13** | **-48** |

The drop from 61 to 13 files is because this snapshot only saw the `docs/` tree
(plus README.md) — `app/`, `lib/`, `components/`, `electron/`, and `scripts/`
were not present in the working tree at snapshot time. The largest non-doc
files from 2026-10-09 (`lib/runner.ts` 675, `electron/main.cjs` 584,
`components/Board.tsx` 555, `lib/login.ts` 377, `components/ProjectBar.tsx`
422) are absent from today's scan, so the "Largest files" table is now
entirely `docs/*` plus the README.

Notable in-scope changes mentioned for this session (not visible in the
snapshot because the changed files are outside the current working tree):

- `electron/server.cjs` grew by ~98 lines (classifier, killPid, readTail,
  resolveSpec, new `child.on('exit')` branches).
- `lib/dev-server.ts` is new (~80 lines).
- `lib/dev-server.test.ts` is new (~150 lines).
- `docs/architecture/desktop-shell.md` grew by ~14 lines
  (visible here: 259 lines, up from ~245).
