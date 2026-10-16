# 016: the board 500'd with a Turbopack panic after a client component imported `node:fs`

**Date:** 2026-10-14 · **Severity:** Critical (the whole board was down)

## Symptom

The board window showed Next's "Runtime Error: An unexpected Turbopack error occurred. Please see the output of
`next dev` for more details." Every `GET /` returned 500. Running `pnpm dev` by hand to see that output failed with
`EADDRINUSE 127.0.0.1:1024`: Electron's supervisor (`electron/server.cjs`) restarts its own `next dev` as soon as
`electron/free-port.cjs` kills it, so the port is taken again within a second.

## Cause

`components/QuestionForm.tsx` (`"use client"`) gained a "Read from <path>" button and imported `suggestReadScope`
from `lib/read-scope.ts`, which checks the disk:

```ts
// lib/read-scope.ts
import fs from "node:fs";
import path from "node:path";
```

```tsx
// components/QuestionForm.tsx (client)
import { suggestReadScope } from "@/lib/read-scope";
const readScope = cwd ? questions.map((q) => suggestReadScope(q.question, cwd)).find(Boolean) : undefined;
```

Turbopack can't put a `node:` built-in in a browser chunk. Instead of a normal "Module not found" build error, it
panics while chunking the `/page` endpoint:

```
Failed to write app endpoint /page
Caused by:
- the chunking context (unknown) does not support external modules (request: node:fs)
```

## Why it was hard to find

- The browser overlay names no file, only "see the output of `next dev`".
- That output is in Electron's server log, not a terminal: `~/Library/Logs/Weft/server.log` (path from
  `electron/server.cjs`). The panic log in `$TMPDIR/next-panic-*.log` names `node:fs` but not the importing module.
- A panic isn't a parse error, so `BuildErrorBar` doesn't keep the last good build running, and
  `lib/import-check.ts` / `lib/route-import-guard.ts` only check that imports resolve, not which side they run on.

Found by listing imports added to client files in the uncommitted diff and grepping them for `node:`.

## Fix

The suggestion is now computed on the server, where the question arrives, and sent to the client as data.

- `lib/runner-ask.ts` `askUser()`: runs `suggestReadScope(q.question, session.spec.cwd)` over the questions and keeps
  the first hit on the `Pending` (`lib/runner-state.ts`); `pendingView()` sends it as `readScope`.
- `lib/types.ts` `PendingPermission.readScope?: { directory: string; token: string }`.
- `components/QuestionForm.tsx` takes a `readScope` prop instead of `cwd` and no longer imports `lib/read-scope.ts`;
  `components/ThreadView.tsx` passes `card.pending.readScope`.

```tsx
// before: client component computes it (pulls node:fs into the browser bundle)
<QuestionForm cwd={card.cwd} … />
// after: the server already found it
<QuestionForm readScope={card.pending.readScope} … />
```

The board served 200 again on the next request, with no restart.

## Key rule

A `"use client"` component never imports a `lib/` module that touches `node:*` (fs, path, child_process, crypto).
Compute on the server and pass the result as data. If the board shows "unexpected Turbopack error", read
`~/Library/Logs/Weft/server.log` and grep the client files' new imports for `node:`.

## Files involved

- `lib/runner-ask.ts`, `lib/runner-state.ts`, `lib/types.ts`
- `components/QuestionForm.tsx`, `components/ThreadView.tsx`
- `lib/read-scope.ts` (unchanged; server-only)
