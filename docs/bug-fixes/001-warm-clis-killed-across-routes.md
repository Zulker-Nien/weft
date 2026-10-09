# 001 — Warm CLIs killed across routes

- **Date:** 2026-10-09
- **Severity:** High (cost and latency; no data loss)

## Symptom

Each follow-up reply on a thread paid a fresh CLI start (~5.7–6s and ~$0.14) instead of reusing the warm session (~2s and ~$0.013–0.027). Spare CLIs started by `/api/warm` were discarded the moment a card was created through `/api/cards`, and calling `POST /api/warm` on an idle card killed and restarted its CLI (the PID changed between calls).

## Root Cause

The runner tried to replace idle sessions started by an older version of the code by stamping each session with a per-module `BUILD` and treating a session as stale when its `build` differed. In Next.js dev, each API route handler can load its **own copy** of `lib/runner.ts`, so each route computed a different `BUILD`. A session opened by `POST /api/cards` looked stale to `/api/cards/[id]/messages` and `/api/warm`, which closed it and started a new CLI. The shared `sessions` / `spares` maps on `globalThis` hid the cause.

The old (broken) computation:

```ts
// lib/runner.ts
const BUILD = randomUUID(); // once per module load
```

`isStale` then returned `true` for any session whose `build` didn't match, even though the two `BUILD` values were produced by identical source code loaded into two different bundles.

## Why It Was Hard to Find

The session maps were already on `globalThis`, so a route that opened a session could see it on a later route. That made the symptom look like a transient "we restarted" issue rather than a per-bundle identity problem, and the failure mode was a slow / expensive reply, not an error.

## The Fix

`BUILD` is now a content fingerprint of the runner's main functions, so identical code gives the same marker in every copy and an edit gives a different one.

```ts
// lib/runner.ts
const BUILD = createHash("sha1")
  .update([drive, handle, askUser, settle, sendMessage].map(String).join("\n"))
  .digest("hex");
```

Staleness is still detected the same way (`lib/runner.ts`):

```ts
function isStale(session: Session) {
  return session.ended || (session.build !== BUILD && !session.busy);
}
```

**Verified:** one CLI process now serves `/api/cards`, `/api/warm`, and `/messages`, and the follow-up reply came back in 2.1s.

## Key Rule

Module-level values in Next route handlers are per-bundle. Anything that must agree across routes lives on `globalThis` or is derived from content — never from a per-load random value.

## Files Involved

- `lib/runner.ts` (the fix)
- Where it showed up, because each route loads its own copy of the runner:
  `app/api/cards/route.ts`, `app/api/cards/[id]/messages/route.ts`, `app/api/warm/route.ts`
