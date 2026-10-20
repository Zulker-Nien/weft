# 025: Clicking a mini app tile opened a blank pane

**Date:** 2026-10-20 · **Severity:** Medium (the pane stood up but no page rendered; the open felt broken)

## Symptom

Clicking a tile under 🖥 Apps opened a pane that looked right (the toolbar, the address bar with the
app's name) but had no page inside it. A second click closed it; reopening stayed blank. The pane was
visible on the board, the resize divider worked, but its body was empty.

## Cause

`components/StandaloneBrowserPane.tsx` is the slide-in/slide-out wrapper the board uses when no card
is open and an app wants the standalone pane. Its outer `<div>` had no `flex`: as a default-block
child of the board's column row, it shrank to its tallest block-level child. The pane's
`components/BrowserPane.tsx` body is a column with `flex-1` for the page placeholder, but the
`<div>` itself was hugging the toolbar (no min-height), so the page placeholder measured **0 px
tall**. The shell's web view (`electron/browser-pane.cjs` `layout`) hides 0 px pages, so the page
never showed. The toolbar and address bar were fine because they're not flex children.

## Fix

Make the wrapper a flex row so it stretches to the board's full height; `BrowserPane`'s flex column
then claims the rest for the page.

Before (`components/StandaloneBrowserPane.tsx`, the wrapper):

```tsx
<div
  className={`shrink-0 overflow-hidden ${shown.closing ? "pointer-events-none" : ""}`}
  style={{
    width: open ? width : 0,
    transition: `width ${SLIDE_MS}ms ease-out`,
  }}
  aria-hidden={!open}
>
  {shown.shown && children(sliding)}
</div>
```

After:

```tsx
<div
  className={`flex shrink-0 overflow-hidden ${shown.closing ? "pointer-events-none" : ""}`}
  style={{
    width: open ? width : 0,
    transition: `width ${SLIDE_MS}ms ease-out`,
  }}
  aria-hidden={!open}
>
  {shown.shown && children(sliding)}
</div>
```

The bug also exposed two follow-on details fixed at the same time (same file and the consumer):

- **`BrowserPane` is `obscured` while sliding.** CSS can't clip a native view with `overflow`, so a
  short transition would show the new page over the columns as the slide started. The pane now
  receives `obscured` for `SLIDE_MS` after `open` turns on, so the page waits until the pane is
  fully in view.
- **The divider is the pane's right edge.** `Board.tsx` reads `pane.split` from the resize and
  passes the resulting width back to `StandaloneBrowserPane`; the resizer sits against the pane's
  right edge, not its left.

**Key rule:** a slide-in wrapper around a column with `flex-1` children must itself be a flex
container along the same axis (or have an explicit height). A block parent lets the column hug its
tallest non-flex child, which for a pane is its toolbar, so the placeholder measures 0 px tall and
the shell hides the page.

**Files:** `components/StandaloneBrowserPane.tsx`, `components/Board.tsx`, `components/BrowserPane.tsx`,
`components/StandaloneBrowserPane.test.tsx` (the slide-in / slide-out behavior, including the open-then-resize
case), `docs/architecture/mini-apps.md`.
