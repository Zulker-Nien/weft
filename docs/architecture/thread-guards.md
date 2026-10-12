# Thread guards

Every board thread's CLI starts from `guardedCli()` in `lib/env.ts`: a stripped environment and a set of hooks that
turn away tool calls no permission mode should allow. They run as `PreToolUse` hooks, so they deny a call before it
runs, in every permission mode (bypass included), and the denial's reason goes back to the model as the tool result.

| Hook | File | Turns away |
| --- | --- | --- |
| Secret guard | `lib/secret-guard.ts` | reading `.env` files, Weft's data secrets, environment dumps (Bash, Read, Grep…) |
| Restart guard | `lib/restart-guard.ts` | killing or restarting Weft's own server, app or port while other cards' turns run |
| Git guard | `lib/git-guard.ts` | git commands that throw away or hide uncommitted work in the shared tree |
| Import guard | `lib/import-check.ts` | (PostToolUse) reports an edit that breaks an import |

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
