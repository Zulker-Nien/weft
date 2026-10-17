# 018: Stop button crashed with "reading 'catch'" of undefined

- **Date:** 2026-10-17
- **Severity:** high (pressing Stop in the reply box threw a runtime TypeError)

## Symptom

`Runtime TypeError: Cannot read properties of undefined (reading 'catch')` at
`components/ReplyBoxActions.tsx` on the Stop button's `onStop`.

## Root cause

`ThreadView` passed `onStop={() => void api.stop(card.id).catch(() => {})}`. `void` makes the arrow
return `undefined`, but `ReplyBox`'s `onStop` is `() => Promise<void>`: `ReplyBoxActions` called
`onStop().catch(onStopError)` and `sendNow`/`sendQueuedNow` do `await onStop()`. The same `void` on
`onShell` swallowed shell errors the box should show.

## Fix

`ReplyBoxActions` wraps the call in `try { await onStop() } catch (err) { onStopError(err) }`, so a
handler that throws or returns no promise still lands in the box's error line. `ThreadView` returns
the promises again (`api.stop(card.id).then(() => {})`).

```diff
-        onStop={() => void onStop().catch(onStopError)}
+        onStop={() => { void (async () => { try { await onStop(); } catch (err) { onStopError(err); } })(); }}
```

**Key rule:** a prop typed `() => Promise<void>` must return its promise; never `void` it at the call site.

## Files

`components/ReplyBoxActions.tsx`, `components/ThreadView.tsx`, `components/ReplyBox.test.tsx` (two regression tests).
