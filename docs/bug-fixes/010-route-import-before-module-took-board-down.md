# 010: a route file imported a module before it existed, and the board went down

- **Date:** 2026-10-13, 07:20 (~5 minutes)
- **Severity:** Critical (the whole board and every `/api` route failed; running cards lost their view)

## Symptom

The board went blank and every request failed, `/api/cards` included, with Next's "Module not found: Can't resolve
'@/components/home/Home'" in `app/page.tsx`. It came back by itself a few minutes later.

## Root cause

The card building the home page edited `app/page.tsx` to `import Home from "@/components/home/Home"` before it wrote
`components/home/Home.tsx`. A missing module in a route file fails the whole route before React runs, and Next's dev
server fails every other route with it, so:

- no `CrashGuard` saw it (nothing rendered, so no error boundary ran);
- `BuildErrorBar` (`lib/build-error.ts`) only keeps the last good build for files that don't *parse*; an unresolved
  import isn't one of those;
- `lib/import-check.ts` did report the broken import, but as a PostToolUse hook: after the edit had landed and the
  board was already down. The board stayed down until the thread wrote the missing file.

## Fix

`lib/route-import-guard.ts`, a PreToolUse hook in every board thread (`lib/env.ts` `guardedCli()`) and in Claude Code
sessions outside Weft (`scripts/import-check-hook.mjs` via `.claude/settings.json`). For an Edit, MultiEdit or Write on
a route file (`app/**/{page,layout,template,error,global-error,not-found,loading,default}`, `app/**/route.ts`, root
`middleware`/`proxy`/`instrumentation`), it works out the file after the edit and denies it if an import the edit
*adds* doesn't resolve (a local file through `import-check`'s resolver, a package through `node_modules`). The reason
tells the thread the order: "write components/home/Home.tsx first, then import it from app/page.tsx".

Imports that were already broken before the edit are let through: not that edit's fault, and refusing would wedge a
thread trying to fix something else in the file.

## Tests

`lib/route-import-guard.test.ts` (100% of the module), including the exact 2026-10-13 edit; `lib/env.test.ts` checks
the guard is wired between the git guard and symbol claims.

## Lesson

A check that runs after an edit can't protect files whose failure takes the whole app down. For those, check before.
Write the module, then import it.
