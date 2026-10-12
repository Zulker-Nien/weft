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

## Files

`lib/secret-guard.ts`, `lib/secret-guard.test.ts`
