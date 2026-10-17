# 021: the cloud-sync outbox never uploaded again after a flush that found you signed out

**Date:** 2026-10-17 · **Severity:** High (a Weft started signed out held 40,700 entries and uploaded nothing, so a shared thread stayed empty)

## Symptom

A shared link showed the card but "Nothing in this thread has synced yet." Settings → Sync read `waiting: 40,733, uploaded: 0` and **Sync now** did nothing. Signing in didn't help either.

## Cause

`flush()` set `s.inFlight = true`, then returned early from inside its `try` when the outbox was empty, you were signed out, or you had no workspace. The `inFlight = false` sat after the `try`/`catch`, so those early returns skipped it. From then on `trigger()` saw `inFlight` and only set `dirty`: no timer, no upload, until Weft restarted. Hot reload didn't clear it (the state is a `globalSingleton`).

```ts
// before
s.inFlight = true;
try {
  …
  if (!client) return;   // signed out: inFlight stays true
  …
} catch { …; s.inFlight = false; trigger(ctx, s.backoffMs); return; }
s.inFlight = false;
```

## Fix

Release it in a `finally`, and schedule the retry after it:

```ts
// after
let retryIn: number | null = null;
try { … } catch { …; retryIn = s.backoffMs; } finally { s.inFlight = false; }
if (retryIn !== null) trigger(ctx, retryIn);
else if (s.dirty) { s.dirty = false; trigger(ctx); }
```

A test signs out, publishes, signs in, publishes again and expects both cards uploaded.

**Key rule:** a busy flag is released in `finally`, never at the end of a function that has early returns.

**Files:** `lib/cloud-sync.ts`, `lib/cloud-sync.test.ts`. Other blockers behind it (a `\u0000` in item text, reused tool ids in one batch) were fixed separately in `c52ad64` and `e89cd61`.
