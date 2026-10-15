# 015: puku threads started blind outside Weft's own folder

## Symptom

A puku card in another project (here `~/dev/groovenfill`) opened its first reply with "I'm Puku CLI… I don't have
any context about a project called groovenfill". It didn't know its working directory, never ended a reply with the
BOARD STATUS line (so the card got no stage), and didn't use the browser pane or the 🔐 vault. Claude Code cards in
the same folder were fine. Puku cards in Weft's own folder seemed fine.

## Cause

Two gaps, measured 2026-10-14:

1. **Puku's gateway drops the client's system prompt.** puku-cli sends it: a captured `/v1/messages` request carried
   the full Claude Code preset with the working directory and Weft's `systemPrompt.append`. But the model never sees
   it. With `--append-system-prompt "Begin every reply with BANANA"` and a PUKU.md saying "Begin every reply with
   KIWI", the reply was "KIWI Hello there". `--system-prompt` is dropped the same way. Only text in messages arrives.
2. **puku-cli reads `PUKU.md`, not `CLAUDE.md` or `AGENTS.md`.** Weft's repo has a PUKU.md that imports SOUL.md and
   AGENTS.md, so a puku thread here got Weft's docs (and the folder, from their paths). Most projects have no PUKU.md.

## Fix

`lib/puku-context.ts` builds a `<system-reminder>` block: the working directory, the project's CLAUDE.md and AGENTS.md
with their `@imports` (left out when there's a PUKU.md, which puku loads itself), and Weft's prompt (the same
`appendPrompt()` Claude Code gets as `systemPrompt.append`). `open()` in `lib/runner-session.ts` stores it as the
session's `preamble`. `sendMessage` puts it in front of the first message the CLI process sends and then clears it.
The thread shows only what you typed.

It goes once per CLI process, so a resumed session gets it again after puku's 10-minute keep-alive closes the CLI.
That costs a few thousand tokens, and it keeps the prompt in the context after a compaction.

## Not covered

The user's global `~/.claude/CLAUDE.md` and Claude Code's auto-memory still don't reach puku threads.
