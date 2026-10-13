# 011: a stray `}` in `Home.tsx` 500ed every board request, paired with #010

- **Date:** 2026-10-13, ~08:55 (~10 minutes — only the time to see the pattern, since `BuildErrorBar` already
  showed the file)
- **Severity:** Critical (the board kept rendering thanks to `BuildErrorBar`, but every `/api/cards`, `/api/pile`,
  `/api/sprint`, `/api/game` and the page itself 500'd in a tight loop)

## Symptom

`~/Library/Logs/Weft/server.log` showed the same error 9 times in a row, each followed by a string of 500s:

```
[browser] ./components/home/Home.tsx:64:1
Error: Unexpected token. Did you mean `{'}'}` or `&rbrace;`?
GET /api/cards 500 in 76ms
GET /api/cards 500 in 79ms
GET /api/pile?cwd=... 500 in 86ms
GET /api/sprint?cwd=... 500 in 65ms
GET /api/game?cwd=... 500 in 42ms
```

The board on screen looked fine — `BuildErrorBar` (`lib/build-error.ts`) caught the error and kept the last
good build running. The "race" was on the server: every card-fetch and every page request that touched
`app/page.tsx` 500'd, the board polled again, and the cycle never ended.

## Root cause

`app/page.tsx` and `app/home/page.tsx` both static-imported `Home`:

```ts
// app/page.tsx
import Home from "@/components/home/Home";
// ...
export default function Page() {
  return isDeployed() ? <Home /> : <Board />;
}
```

A parse error in `Home.tsx` (a missing `</>`) makes the whole `app/page.tsx` route module fail to evaluate on
the server, and Next 16.4's dev server then 500s every request that goes through that route — including
`/api/cards`. `BuildErrorBar` is a *client-side* guard: it keeps the board on the last good build, but it
cannot stop the server from 500-ing. The race is `app/page.tsx` static-importing a module it does not render
in dev.

## The fix

`loadHome()` in `lib/home.ts`: a tiny helper that does `await import("@/components/home/Home")`, caches the
resolved component for the lifetime of the process, and on failure returns a `{ error: { message, file } }`
shape the route's fallback renders.

- `app/page.tsx` — calls `loadHome()` only inside the `isDeployed()` branch. In dev the import is never
  evaluated, so a parse error in `Home.tsx` cannot reach the board route.
- `app/home/page.tsx` — calls `loadHome()` always, but behind `await`, with a small fallback when the import
  throws. The build error bar still shows the real error; the fallback just keeps the rest of the app reachable.
- `lib/home.test.ts` — four new tests for `loadHome()`: resolves the default export, caches across calls,
  parses the file and first message line out of a Next-shaped parse error, and reports a missing default export.

## Why this, and not more

This is the **parse-error** companion to bug-fix #010 (the route-import-guard). #010 refuses the *edit* that
would add an import for a module that doesn't exist yet; this one narrows the runtime blast radius when the
file does exist but won't parse. Together they cover the two ways a route module can fail to load.

A PreToolUse hook for parse errors would be nice, but parse errors are caught at compile time by Next + the
existing `lib/import-check.ts` post-hook + the build error bar. The only remaining gap was the *runtime* blast
radius when the file fails mid-edit, which is what `loadHome()` closes.

## Tests

`lib/home.test.ts` covers `loadHome` (4 cases). The four pre-existing test failures in the working tree
(`electron/secret-run.test.ts`, `lib/secret-tools.test.ts`, `lib/vault-view.test.ts`) are unrelated to this
change.

## Lesson

For a route that *conditionally* renders a module, the import has to be conditional too. A static import is
a load-time promise that the file will parse and resolve; breaking that promise breaks the whole route, not
just the call site. `BuildErrorBar` is the right primitive for the client; the server needs its own narrow
defense at the import site.
