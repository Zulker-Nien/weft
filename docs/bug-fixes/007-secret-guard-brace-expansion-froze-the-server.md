# 007: secret guard's brace expansion froze the board's server

- **Date:** 2026-10-12
- **Severity:** high (the whole board stopped answering for 15+ minutes; New thread's Start did nothing)

## Symptom

Start in the New thread dialog stayed greyed out. Every request to the board's server hung until Weft restarted.

## Root cause

`lib/secret-guard.ts` expands `{a,b}` in each shell word to check every name it could stand for. It expanded one group at a time, so a Python heredoc with 25 `{'a': 1, 'b': 2}` groups became 2^25 copies of the whole script, run synchronously in the PreToolUse hook on the server's event loop.

## Fix

```ts
// before: recurse on the first group, every combination built
m ? alts.flatMap((alt) => expandBraces(glob.replace(m[0], alt))) : [glob]
// after: count first; over MAX_EXPANSIONS (256) check the glob's pieces one by one
if (total > MAX_EXPANSIONS) return glob.split(/[\s{},]+/).filter(Boolean);
```

Groups in one word also expand in a single pass (`expandGroups`), so a script's many blocks cost one copy.

**Key rule:** never expand input-controlled patterns without counting the result first.

## Follow-up (2026-10-12): the OOM it caused, and the size cap

The server.log crash at 2026-10-11 16:07 UTC (pid 31177, ~8 GB after 350 s, "Ineffective mark-compacts near heap
limit") was this bug. 31177 was `next dev`'s server process (its own SQLite warning prints at startup; 32435 and
32704 were later child processes). The native stack runs the CLI's stdout read (`LibuvStreamWrap::OnUvRead`, the SDK's
hook callback) → a microtask → nested `Array.prototype.flatMap` → `RegExp.prototype.exec`: the old recursive expansion.
No child-process buffer was at fault: `lib/devserver.ts`, `lib/login.ts`, `electron/secret-run.cjs` and
`electron/server.cjs` all keep a capped tail.

The 256-word cap still let a 1.2 MB heredoc with 8 groups become 256 copies (300 MB) and check ~51M tokens: 300+ s.
Now the cap also counts characters (`MAX_EXPANDED_CHARS`, 64 KB; past it the word is checked once with its braces as
spaces), `secretIn` checks each distinct token once, and tokens with no secret stem (`MAYBE_SECRET`, built from
`DATA_NAMES`) skip `isSecretFile`'s `path.resolve`. Same script: ~0.2 s.

## Files

`lib/secret-guard.ts`, `lib/secret-guard.test.ts`
