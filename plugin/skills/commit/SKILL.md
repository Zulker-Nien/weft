---
name: commit
description: Stage and commit changes using conventional commits. Use when the user asks to commit, create a commit, or says "commit". Ships with Weft for board automations.
argument-hint: "[optional message override]"
---

Create a git commit for the current changes in the repository you are working in.

This copy ships with Weft (from `fotoflo/claude-skills`, without its Vercel preview-deploy step).
On a Weft card, commit the files this thread changed; other threads may share the working tree.

## Steps

1. Run `git status` and `git diff` in parallel to understand what changed
2. Run `git log --oneline -5` to match the repo's commit message style
3. Stage only relevant changed files by name (never `git add -A` or `git add .`)
   - Skip `.claude/settings.local.json` and other non-code config unless explicitly changed as part of the task
4. Draft a commit message:
   - Use conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `style:`, `chore:`
   - One line summary focused on the *why*, not the *what*
   - If $ARGUMENTS is provided, use it as the commit message instead
5. Commit using a HEREDOC to preserve formatting. Attribute the commit to the model
   you are actually running as — do not copy a model name from this file:
   ```
   git commit -m "$(cat <<'EOF'
   <type>: <summary>

   Co-Authored-By: <your model name> <noreply@anthropic.com>
   EOF
   )" -- <the paths you staged in step 3>
   ```
   The `-- <paths>` makes the commit take only those files. Without it, `git commit`
   takes the whole index, including anything another session working in the same
   tree has staged. Keep `git add` first: a pathspec commit can't see a new file until
   it is tracked.
6. Run `git status` to confirm the commit landed. Other sessions' changes may still
   show as modified or staged; that's expected, so leave them alone

## Rules

- NEVER use `--no-verify` or skip hooks
- NEVER amend — always create a new commit
- NEVER commit `.env`, secrets, or credential files
- NEVER force push
- NEVER run a bare `git commit` or `git reset`; both act on the whole index, which
  other sessions may share. Commit and unstage by explicit path
- Do NOT push unless the user explicitly asks
