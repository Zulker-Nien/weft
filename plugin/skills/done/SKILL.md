---
name: done
description: Wrap up a coding session — scout it for refactors, update docs, test, then commit. Weft runs it when you move a card to Done. Use when the user says "done", "wrap up", or "finish".
argument-hint: "[optional commit message]"
model: sonnet
---

Wrap up the current coding session: commit it, document it, and scout it for what to improve next.

## On a Weft card

Weft runs this in the card's own thread when the user moves the card to Done, so the session is this
thread's conversation. Nobody is watching the turn: don't stop to ask unless something blocks the
commit. Committed cleanly → `column=done`; tests fail or lint errors remain → `column=review` with
what's left. Show the wrap-up in the browser pane, not as ASCII art.

Every `Agent` call names its `model` (`"haiku"`): an agent without one inherits the parent's model,
and a 1M-context parent bills 1M-context credits.

**Scripts measure; agents judge.** Anything countable runs in a script in seconds. Spend model turns
only on what a script can't do: write docs, read failures, decide what's worth refactoring.

## Session files

Several sessions may share this branch and working tree, so git history (`HEAD~3`, a broad
`git diff`) is not a reliable list of this session's work. Use your memory of the conversation:
every file you edited, created or wrote. That list is the "session files" below.

## Phase 0: Context (you, ~5s)

1. Compile the session files.
2. Run `${CLAUDE_SKILL_DIR}/gather-context.sh` (diff stats, existing docs, uncommitted files).
3. Run `${CLAUDE_SKILL_DIR}/lint.sh <session files>` and fix what it reports in session files
   yourself. The pre-commit hook lints staged files, so the commit won't pass without it.
4. Run `${CLAUDE_SKILL_DIR}/scout-facts.sh <session files>` and keep its output for the scout.
5. Note whether a bug was fixed this session (for the bug-fix doc).

## Phase 1: One Puku batch (parallel, a few minutes)

Run the agents below on the Puku gateway through the `puku-agent` skill: free, no Anthropic tokens,
and their file reads stay out of your context. Fall back to the Agent tool (`model: "haiku"`) only
when `~/.claude/skills/puku-agent` is missing or the batch fails on credentials.

1. Write one prompt file per agent in your scratchpad (not the repo). Each holds the session file
   list, a paragraph on WHAT changed and WHY (the agents can't see this conversation), and its
   instructions below.
2. Write `tasks.json` beside them (absolute `prompt_file` paths):
   ```json
   [
     {"id": "docs",  "model": "opus-4.8", "tools": "write", "prompt_file": "<dir>/docs.md"},
     {"id": "scout", "model": "opus-4.8", "tools": "bash",  "prompt_file": "<dir>/scout.md"},
     {"id": "tests", "model": "opus-4.8", "tools": "bash",  "prompt_file": "<dir>/tests.md"}
   ]
   ```
3. From the repo root, in the background:
   `node ~/.claude/skills/puku-agent/puku-agent.mjs --batch <dir>/tasks.json --out <dir>/out --workdir . --quiet`
4. When it finishes, read `<dir>/out/summary.json` and each `<dir>/out/<id>.md`.

### docs agent

1. For each feature area the session files touch, update its doc in `docs/architecture/` (or create
   one in the style of its neighbours): overview, key files, data flow, important patterns.
   Document the current state, not the history. Skip trivial changes.
2. Only if a bug was fixed (you'll say so in the prompt, with symptom, root cause and fix): add
   `docs/bug-fixes/NNN-short-description.md` (next number) with date, severity, symptom, root cause,
   the fix with before/after snippets, a one-line key rule, and the files involved.
3. Report what it created or updated.

### scout agent

Give it the `scout-facts.sh` output. Its job is judgment, not measurement:

1. Read the session files and the code they call or duplicate.
2. Find up to 8 things most worth changing next, worst first:
   - a smell named Fowler-style (Long Function, Duplicated Code, Feature Envy, Primitive Obsession,
     Shotgun Surgery, Data Clumps…) at file:line;
   - a lint rule worth turning on, or a per-file lint override the facts say may now be removable;
   - a loose type: a plain `string` where a union fits, `as` casts, optional fields that are always set;
   - a risky change with no test.
3. Don't edit anything. Write the findings as a JSON array to `<dir>/out/findings.json`, each
   `{"file", "line", "smell", "category": "refactor|lint|types|tests|guardrails", "severity":
   "high|medium|low", "fix"}`. `fix` is one sentence saying what to change, specific enough to be a
   card's prompt ("Extract the permission check out of startTurn into canUseTool() in
   lib/permissions.ts").
4. Report the top three in a line each.

### tests agent

1. Run `${CLAUDE_SKILL_DIR}/tests.sh <session files>` (vitest: only the related tests).
2. Don't edit files. Report files, passed, failed, duration; for each failure the test name, the
   first lines of the error, and the likely cause at path:line.

## Phase 2: Verify (you)

The reports are leads, not facts:
- **Lanes.** `git status --short`: docs may touch only `docs/architecture/` and `docs/bug-fixes/`;
  scout and tests touch nothing. Restore anything outside those lanes unless it's a fix you'd make.
- **Docs.** Read every doc diff and check each path, function name and number against the code.
- **Tests.** A failure report tells you where to look; fixing it is your job.
- **Scout.** Drop findings that are wrong or trivial, then run
  `node ${CLAUDE_SKILL_DIR}/scout-save.mjs <dir>/out/findings.json <session files>`. It merges them
  into the report Weft's quality badge reads, where each finding can start a card.

## Phase 3: SOUL.md (you)

Only if the project has one, and only when this session changed what it states: the file map, values
or conventions, hotspot sizes, the "Known gaps" list (refresh its verified date), or test/CI status.
First person, the file's terse style, current state only. No `SOUL.md` → say `/weft:setup-done`
can create one.

## Phase 4: Commit (you)

1. Message: conventional commits; `$ARGUMENTS` as the first line if given. Body: what changed and
   why, in a few lines. End with the session's Co-Authored-By line.
2. `${CLAUDE_SKILL_DIR}/commit.sh "message" file1 file2 ...` with exactly: the session files, the
   docs and lint fixes you verified, `SOUL.md` if it changed. It `git add`s each path and commits
   only those paths, so other sessions' staged work stays out.

## Phase 5: Report (you)

Show it in the browser pane as one HTML page, and say it in a few lines: the commit (hash, files,
+/- from `${CLAUDE_SKILL_DIR}/session-stats.sh <session files>`), tests passed/failed, docs touched,
SOUL.md change, and the scout's top three with their fixes.

## Rules

- Never `--no-verify`, `--amend`, force push, a bare `git commit`, `git reset` or `git stash`;
  other sessions share this index and tree.
- Fix lint only in session files; no codebase-wide cleanup. The scout reports, it doesn't fix.
- Never commit `.env`, secrets or credentials. Don't push unless asked.
