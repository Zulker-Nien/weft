# 006: Escape didn't close the open panel

**Date:** 2026-10-11 | **Severity:** Medium

## Symptom
After sending a message in the New thread dialog, with nothing clicked, Escape did nothing. Later, in a
thread with text in the reply box, Escape took focus out of the box and the panel stayed open until a second press.

## Root Cause
Three separate causes:
1. **Focus.** Loading a page in the browser pane takes keyboard focus. Opening New thread loads the splash
   page there, so the pane held focus; when the card opened and that view was hidden, nothing had focus and
   no key reached the board.
2. **Typed text.** The thread's Escape handler used `keepTypedText`, which blurred a field with text instead
   of closing. Reply drafts are already saved per card, so the guard only cost a keypress.
3. **Layer order.** `useEscape` closed the layer that became active last, so a board panel (thread, browser,
   library) opened while a dialog was up closed first.

## The Fix
- `electron/browser-pane.cjs`: after a page loads, the board gets focus back if it had it; hiding a view
  that has focus hands focus to the board.
- `components/ReplyBox.tsx`: `saveDraft` keeps what isn't written yet and writes it when the box unmounts,
  so Escape closes at once and the last 300ms of typing survives. `keepTypedText` is gone.
- `lib/use-escape.ts`: `useEscape(active, fn, { panel: true })` marks board panels, which sit under every
  dialog and menu whatever order they opened in. `Board.tsx` marks the thread, browser and library.

## Key Rule
A hidden or loading pane view must never keep keyboard focus, and Escape closes dialogs and menus before
board panels.

## Files Involved
`electron/browser-pane.cjs`, `components/ReplyBox.tsx`, `components/Board.tsx`, `lib/use-escape.ts`,
`lib/use-escape.test.ts`, `components/ReplyBox.test.tsx`
