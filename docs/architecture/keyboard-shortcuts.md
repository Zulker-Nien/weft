# Keyboard shortcuts

## Overview

One registry holds the board's keyboard shortcuts. Components register theirs, a single window listener dispatches key presses, and the `?` dialog lists whatever is registered, so a new shortcut shows up in the list with no extra work.

Two other pieces share the name and are separate: `lib/shortcuts.ts` holds user-rebindable bindings (dictation) kept in localStorage, and the native menu accelerators in `electron/main.cjs` (⌘N, ⌘F, ⌘, and so on) are handled by Electron.

## Key files

- `lib/hotkeys.ts`: the registry, `useShortcuts`, `useShortcutListener`, `useShortcutList`, and `keyCaps` for drawing keys.
- `components/ShortcutsDialog.tsx`: the `?` dialog, generated from `useShortcutList()`.
- `components/Board.tsx`: registers the board shortcuts and mounts the listener once.
- `components/CardView.tsx`: cards carry `data-card-id`, and `Board` marks each column with `data-column`; keyboard navigation moves DOM focus between them.

## How it works

- A key is written `"n"`, `"?"`, `"ArrowDown"`, or `"mod+k"` (`mod` is ⌘ on macOS, Ctrl elsewhere; `alt` and `shift` also work). Letters compare case-insensitively; for a symbol like `?`, Shift is whatever it takes to type it.
- Plain keys are ignored while typing in an input, textarea, select, or editor. A shortcut using `mod` or `alt` still fires there, and `allowInInput` opts one in outright.
- When several shortcuts share a key, the one registered last runs first. A handler returning `false` passes the key on to the next and leaves the browser default alone; anything else counts as handled and prevents the default. This is what Escape handling should build on: a dialog registers Escape with `allowInInput` and returns `false` when it has nothing to close.
- `useShortcuts` reads keys and descriptions once, at mount; handlers and `enabled` follow the latest render, so they can use current state. The list must keep the same ids on every render.
- A disabled shortcut stays in the help list. Board shortcuts are disabled while a dialog or the project menu is open.

## Current shortcuts

General: `?` or ⌘/ help, `n` new thread, `/` filter, `,` settings, `c` copilot, `b` browser.
Board: `j`/`k` or ↓/↑ between cards, `h`/`l` or ←/→ between columns, Home/End first and last card, Enter or `o` open the focused card, `a` jump to a card that needs you, `[`/`]` previous and next project, `s` cycle sort.
Thread: `r` reply in the open thread.

## Gotchas

- Enter opens a card only when the card itself has focus, so it still presses a button inside one.
- Don't register a shortcut that duplicates a native menu accelerator; in the desktop app the key may reach both.
