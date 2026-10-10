# File sizes

Lines per source file (app, lib, components, electron, scripts, docs, and the config files).
Snapshot: 2026-10-10

| Lines | Files |
|---|---|
| <=50 | 4 |
| 51-150 | 7 |
| 151-300 | 3 |
| 301-500 | 0 |
| 501-1000 | 0 |
| 1001-2000 | 0 |
| 2000+ | 0 |

Total files: 14. Over 500 lines: 0.

## Largest files

| Lines | File |
|---|---|
| 288 | docs/ROADMAP.md |
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
| 63 | docs/architecture/glance.md |
| 48 | docs/file-sizes.md |

## Delta from 2026-10-10 (earlier today)

| Bucket | 2026-10-10 (earlier) | 2026-10-10 (now) | Change |
|---|---|---|---|
| <=50 | 5 | 4 | -1 |
| 51-150 | 5 | 7 | +2 |
| 151-300 | 3 | 3 | 0 |
| 301-500 | 0 | 0 | 0 |
| 501-1000 | 0 | 0 | 0 |
| 1001-2000 | 0 | 0 | 0 |
| 2000+ | 0 | 0 | 0 |
| **Total** | **13** | **14** | **+1** |

Largest-files changes:

- `docs/ROADMAP.md`: 285 → 288 (+3)
- `docs/architecture/glance.md`: new at 63 lines

All other rows unchanged. The earlier-today snapshot only saw the
`docs/` tree (plus README.md); `app/`, `lib/`, `components/`,
`electron/`, and `scripts/` were not present in the working tree at
snapshot time, so the "Largest files" table is again entirely
`docs/*` plus the README. The largest non-doc files (e.g.
`lib/runner.ts`, `electron/main.cjs`, `components/Board.tsx`)
remain absent from this scan.
