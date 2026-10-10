# 005: archived cards counted as "need you"

**Date:** 2026-10-11 | **Severity:** Low

## Symptom
The header said "4 need you" and a project chip showed a needs-you dot, but the Needs you column
was empty and "Jump to a card that needs you" did nothing.

## Root Cause
The header totals (`components/Board.tsx`) and `summarizeProjects` (`lib/board-view.ts`) counted
cards by column alone. The four cards sat in `needs_you` with `archived: true`, which the board
hides, so the counts included cards nobody could see.

## The Fix
Both counts now skip archived cards. Archived cards still count toward a chip's `cards` total.

## Key Rule
Anything that counts cards for display must apply the same archived filter as the column it points at.

## Files Involved
`components/Board.tsx`, `lib/board-view.ts`, `lib/board-view.test.ts`
