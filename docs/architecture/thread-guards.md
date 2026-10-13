# Thread guards

Every board thread's CLI starts from `guardedCli()` in `lib/env.ts`: a stripped environment and a set of hooks that
turn away tool calls no permission mode should allow. They run as `PreToolUse` hooks, so they deny a call before it
runs, in every permission mode (bypass included), and the denial's reason goes back to the model as the tool result.

| Hook | File | Turns away |
| --- | --- | --- |
| Secret guard | `lib/secret-guard.ts` | reading `.env` files, Weft's data secrets, environment dumps (Bash, Read, Grep…) |
| Restart guard | `lib/restart-guard.ts` | killing or restarting Weft's own server, app or port while other cards' turns run |
| Git guard | `lib/git-guard.ts` | git commands that throw away or hide uncommitted work in the shared tree |
| Route import guard | `lib/route-import-guard.ts` | an edit that makes a route file import a module that isn't there yet |
| Import guard | `lib/import-check.ts` | (PostToolUse) reports an edit that breaks an import |
| Symbol claims | `lib/claim-guard.ts` | asks (doesn't deny) before an edit to a symbol another busy card is editing |

## Symbol claims

Cards in one folder share a working tree, so two threads can edit the same function at once and fold their work
into each other. Claims catch that at the moment it happens, instead of a standing "also running here" line.

- **What a card claims** (`claimsFor` in `lib/claim-guard.ts`, `lib/symbols.ts`): for an Edit or MultiEdit on a
  TS/JS file, the hook reads the file, finds each `old_string` (every match with `replace_all`) and parses it with
  `ts.createSourceFile` (no type-checker). Each top-level statement the match overlaps, with its leading comments
  but not the blank lines after it, gives a claim `<real path>#<name>`: functions, classes, `const` components
  (destructured names too), types, interfaces, enums, namespaces, and `default`. Imports and `export … from`
  are never claimed. The whole file (`<path>#*`) for Write, NotebookEdit, other files, an `old_string` that isn't
  there (a MultiEdit edit that depends on an earlier one), a nameless statement (a bare call), or more than five
  symbols in one edit (a restructure: each symbol would be noise). Paths are real paths, the way git names them,
  with `#` and `%` escaped (`%23`, `%25`) so a key's first `#` starts the symbol.
- **Nested claims** (`NEST_LINES = 150` in `lib/symbols.ts`): a top-level symbol over 150 lines would be a whole-file
  claim in practice (Board() is lines 125–1013 of `components/Board.tsx`), so the walk goes inside it and claims the
  statement holding the edit, then again inside that one if it's long too. Function and method bodies split into
  statements, classes into members, a JSX element (a `return (…)`, an arrow's JSX body, `{items.map(…)}`) into its
  children, and a call into its function argument's body (`memo(function …)`, `useEffect(() => …)`, `describe(…)`).
  Each part is named by what it declares (`moveFocus`, the first name of a destructuring: `open` for
  `const [open, setOpen] = useState()`), the call it makes (`useBoardEvents`, `ipcMain.handle`), its JSX tag
  (`Header`, the first tag inside `{open && <Dialog/>}`), or its kind (`return`, `if`, `for`, `fragment`, `text`).
  A name that repeats among siblings gets its order: `useEffect#1`, `useEffect#2`. Keys join the path with `/`:
  `Board/return/main/Item#43`. An edit to the long symbol's own lines (its signature, its closing brace) claims it whole.
  A claim clashes with one inside it, so `Board` and `Board/moveFocus` clash, and `Board/moveFocus` and
  `Board/paletteItems` don't. Order numbers shift when a sibling of the same kind is added above, so two claims on
  one `useEffect` can miss each other after such an edit; the next edit's claim is current again.
- **When it asks** (`lib/claims.ts` `findClash`): another card that's busy (`isBusy`) in the same tree (`sameTree`)
  holds the same symbol, or either side covers the whole file. The PreToolUse hook answers `ask` and the card's
  permission prompt reads "Card ‘<title>’ is editing <Symbol> in <file>. Wait, or go ahead?" (`claimQuestion`,
  used as the prompt title in `lib/runner-session.ts`). It reads board data and the one file; no git.
- **Recording**: the PreToolUse hook keeps what the edit will claim by tool use id, and the PostToolUse hook puts
  it on `card.claims` (most recent first, last 50) once the edit has run, so a denied edit claims nothing.
- **Dropping**: `updateCard` (`lib/store.ts`) clears a card's claims when it reaches Done or is archived;
  `lib/pile-commit.ts` calls `releaseClaims` for the paths it committed, on every card (the whole file went in).
  A thread's own `git commit` doesn't release them yet: they stay until Done.
- **Speed**: `typescript` loads on the first edit of a source file (~170 ms, once per server), never on the
  start-a-card path; parsing the 46 KB `Board.tsx` and walking it takes 5–13 ms warm, ~40 ms the first time.

## Reading a command line

The Bash guards don't match strings: `lib/shell-parse.ts` reads the line the way the shell would, and
`steps()` in `lib/restart-guard.ts` turns it into every command it would run, each with the folder it runs in.
That covers `a && b; c | d`, `$( )` and backticks, `sh -c '…'`, a heredoc fed to `bash`, `eval`, `xargs`,
`sudo`/`env FOO=1` prefixes, and `cd x &&` carrying to the commands after it. The git guard uses the same walk.

## Git guard

Weft gives every card in a folder one working tree (no worktree per card, on purpose: see SOUL.md), so a git command
that discards or stashes uncommitted changes takes every card's work, not just its own. On 2026-10-12 one thread's
`git stash` took 112 files of the board's work out of the tree. The guard refuses:

- `git stash` with any subcommand but `list` and `show` (push, pop, apply, drop, clear, `-u`, …)
- `git reset --hard` (a plain or `-- paths` reset only touches the index and is fine)
- `git checkout -- <path>`, `git checkout .`, `git checkout <tree> <path>`, pathspec magic (`:/`, globs) and
  `git checkout -f`; a plain branch checkout is fine (git refuses it when it would lose changes)
- `git switch -f` / `--discard-changes`
- `git restore` unless it's `--staged` (`-S`) alone, without `--worktree` (`-W`)
- `git clean -f` (but `-n` / `--dry-run`)

It reads git's own options first (`-C dir` moves the folder; `-c`, `--git-dir`, `--work-tree` skip their value), so
`git -C ~/dev/weft stash` is caught too. A folder under the temp folder (`os.tmpdir()`, `/tmp`, `/private/tmp`) is a
scratch clone no card owns, and is left alone.

The refusal says why and points to the safe ways:

- commit by path: `git commit -m '…' -- <your files>`
- or commit through a temp index: `GIT_INDEX_FILE=/tmp/idx git read-tree HEAD`, `… git add <files>`, `… git commit`,
  then `git reset -q -- <files>` so the real index matches the new HEAD
- read a clean copy of a file: `git show HEAD:path > /tmp/x`
- undo your own change by editing the file back, or ask the user to clean the tree

Tests: `lib/git-guard.test.ts` (each refused form, the allowed ones, scratch folders, the hook), `lib/env.test.ts`
(it's wired into `guardedCli`).

## Route import guard

A missing module in a route file fails the whole route before React runs, and in Next's dev server every `/api`
route with it, so no `CrashGuard` sees it and `BuildErrorBar` (which keeps the last good build for files that don't
parse) can't help. The import guard's PostToolUse report comes too late for these files: the board is already down
(docs/bug-fixes/010). So `lib/route-import-guard.ts` denies the edit before it lands.

- **Which files**: relative to the project root (nearest `tsconfig.json` or `package.json`), `app/**/{page,layout,
  template,error,global-error,not-found,loading,default}.{tsx,ts,jsx,js}`, `app/**/route.{ts,js}`, and the root's
  `middleware`, `proxy` and `instrumentation`, with or without `src/`. Every other file gets only the PostToolUse report.
- **The file after the edit** (`contentAfter`): a Write's `content`; an Edit's or MultiEdit's `old_string` →
  `new_string` applied to the file on disk, in order (`replace_all` too). An edit that can't apply is let through:
  the tool fails on its own.
- **Only what the edit adds** (`addedImportProblems`): every `from "x"`, bare `import "x"` and `import("x")` in the new
  text that the old text didn't have. A local one (`./`, `../`, `@/`) must resolve through `resolveSpec()` in
  `lib/import-check.ts` (same extensions and `index` files); a package must be in a `node_modules` at or above the
  file. Builtins, `#` and `~` aliases are skipped, and packages too when there's no `node_modules` at all.
- **The reason says what to do**: `"@/components/home/Home" doesn't exist yet: write components/home/Home.tsx first,
  then import it from app/page.tsx.` (the importer's extension when the import has none), or `install <pkg> first`.
- **Speed**: regexes and `stat`s on the added imports, no type-checker and no git; it only reads the edited file.
- **Outside Weft**: `scripts/import-check-hook.mjs` runs as both the PreToolUse and the PostToolUse hook in
  `.claude/settings.json`, branching on `hook_event_name`; a `registerHooks()` resolve hook lets Node's type
  stripping load `lib/` files that import their neighbours without `.ts`. It exits early in board threads, which get
  the in-process guard.

