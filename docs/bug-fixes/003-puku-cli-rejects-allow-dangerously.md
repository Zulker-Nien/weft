# 003 — puku-cli rejects `--allow-dangerously-skip-permissions`

- **Date:** 2026-10-10
- **Severity:** High (every puku-backend card died at spawn; no way to start one)

## Symptom

Starting any card with `spec.backend === "puku"` failed immediately. The card turned red on first message and the thread log showed:

```
Claude Code process exited with code 1. stderr: error: unknown option '--allow-dangerously-skip-permissions'
```

Claude-Code-backend cards worked as before. Every puku card — including the project's own "Try puku" sample — produced a red error pill and a dead turn.

## Root Cause

`lib/runner.ts` was passing `allowDangerouslySkipPermissions` to the Agent SDK for every card, gated only by `!spec.copilot`. The Claude Code binary understands the flag and skips the confirm-on-permission prompt. puku-cli's CLI does not — its argument parser rejects `--allow-dangerously-skip-permissions` as an unknown option, and the SDK turns the spawn failure into the stderr message above.

The pre-fix line:

```ts
// lib/runner.ts (~line 548)
allowDangerouslySkipPermissions: !spec.copilot,
```

For a puku card, `!spec.copilot` is `true`, so the SDK forwarded the flag to puku-cli, which died before producing any output.

## Why It Was Hard to Find

Obvious from the error, but only triggered on the second backend. Puku had been added recently and hadn't been exercised end to end (SOUL.md's "Known gaps" still lists *"a full puku thread hasn't been verified end to end"*). A Claude-Code user could refactor the runner, run `npm test`, and never see it — the bug lives in a code path that only one backend ever hits.

## The Fix

Gate the option on the backend as well as the copilot flag. Only Claude Code cards opt in; puku cards pass nothing.

```ts
// lib/runner.ts
allowDangerouslySkipPermissions:
  spec.backend === "claude" && !spec.copilot ? true : undefined,
```

The SDK omits the CLI flag when the value is `undefined`, so puku-cli's argument parser never sees it.

**Verified:** a fresh puku-backend card now starts cleanly, the warm CLI is reused across turns, and the project's sample puku card produces output instead of a red pill.

## Key Rule

CLI flags that the SDK forwards to the underlying binary are backend-specific. Anything that touches `pathToClaudeCodeExecutable`-adjacent options must be gated on `spec.backend`, not just on `spec.copilot` or a feature flag.

## Files Involved

- `lib/runner.ts` (the fix, near line 548)
