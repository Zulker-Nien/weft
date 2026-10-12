# Error boundaries

Threads edit Weft's own source while Weft runs in dev mode, so the board regularly meets a half-written file: a JSX
tag before its import, a renamed prop, a constant that references a component not imported yet. The boundaries keep
each failure in the smallest spot that owns it, with the error shown and a way to try again once the edit lands.

## Layers, outermost first

| Boundary | Catches | Shows |
| --- | --- | --- |
| `app/global-error.tsx` | the root layout | a bare page with Try again and Reload |
| `app/error.tsx` | `Board.tsx` itself, or a static import of it | "The board failed to draw"; hides the browser pane while it shows (the pane is a native view over the window) and restores it after |
| `guarded()` pieces | a component that throws as it draws **or as its module loads** | the CrashGuard fallback in that piece's spot |
| `CrashGuard` wrappers | a component that throws as it draws | a box, or with `inline` a one-line chip |

## Key files

- `components/CrashGuard.tsx`: the boundary (`catchError` from `next/error`). Props: `what` ("card", "reply box"),
  `name` (which one), `className`, `inline` (a chip with the error in a `Tip` on hover; click retries), `onClose`
  (adds Close beside Try again).
- `components/guarded.tsx`: `guarded(() => import("./X"), { what, inline?, className?, placeholder? })` returns a
  component that loads `X` with `import()` inside a CrashGuard. It takes the loaded component's props plus
  `guardName`, and passes the component's own `onClose` to the fallback.
- `components/Modal.tsx`: every dialog's body sits in a CrashGuard under its header, so ✕ and Escape still work.

## Why `guarded()` exists

A CrashGuard only catches errors thrown while React renders. A module that throws while it *evaluates* (for example
`const TOOLS = { blastcp: [<BlastcpLogo />, …] }` written before `import BlastcpLogo`) fails every module that statically
imports it, up the chain to `Board.tsx`, and only `app/error.tsx` is left to catch it. Loading the piece with
`import()` turns that into a rejected promise. `guarded()` stores it and throws it while rendering, where the piece's own
CrashGuard catches it.

How it loads:
- The import starts when the module that calls `guarded()` evaluates (browser only), so the piece is usually ready by
  the time it's first drawn.
- Its state is read with `useSyncExternalStore`, with a server snapshot of `null`, so SSR and hydration draw the
  placeholder and later mounts draw the component on their first render, with no flash on opening a thread or dialog.
- A failed load forgets its promise, so Try again (which remounts) calls `import()` again.

## Where it's used

- `Board.tsx`: AccountButton, CopilotButton, HeaderBadges, LibraryRail, CardView, ThreadPanel, BrowserPane,
  NewCardDialog, TerminalDrawer, BoardFooter, ModifierHint and every dialog (Settings, Shortcuts, Tags, Login,
  CommandPalette). ProjectBar stays a static import (Board uses its `folderName`) inside a plain CrashGuard.
- `HeaderBadges.tsx`: each badge (quality, pile, backlog, streak), inline.
- `ThreadPanel.tsx`: ReviewPanel. `ThreadView.tsx`: ReplyBox.
- Plain CrashGuards: each thread message and tool run and the streaming reply (`ThreadItems.tsx`, inline); the
  permission request (`ThreadView.tsx`); mode picker, skill menu and ☆ (`ThreadPanel.tsx`, inline); each library drawer's
  body (`LibraryRail.tsx`); the copilot window's conversation (`CopilotChat.tsx`).

## Patterns

- Use `guarded()` for a sizeable piece a thread is likely to edit; a plain CrashGuard is enough for a piece whose
  module is stable but whose data can be odd (a message's Markdown).
- Keep a type-only import (`import type { PaletteItem }`) when the parent needs the module's types; a value import
  brings the static failure back.
- Never build JSX in a module-level constant when a function or a component would do; it moves render work to load time.
- Tests: `components/guarded.test.tsx` (load, preload, failed load caught and retried, Close, placeholder) and
  `components/crash-guards.test.tsx` (inline chip, Modal, one broken message).
